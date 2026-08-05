import express from "express";
import crypto from "node:crypto";
import { nanoid } from "nanoid";

import { verifyAppProxy } from "../middleware/verifyAppProxy.js";
import { getValidOfflineToken } from "../lib/offlineTokens.js";
import { shopify } from "../lib/shopify.js";
import { prisma } from "../lib/db.js";

export const proxyRouter = express.Router();

proxyRouter.use(verifyAppProxy);

function normalizeEmail(value) {
    return String(value || "")
        .trim()
        .toLowerCase();
}

function normalizeOrderNumber(value) {
    return String(value || "")
        .trim()
        .replace(/^#/, "")
        .toLowerCase();
}

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

proxyRouter.post(
    "/withdrawal-request",
    async (req, res) => {
        try {
            const {
                customerEmail,
                customerName,
                orderNumber,
                reason,
                locale,
            } = req.body ?? {};

            const cleanCustomerEmail =
                normalizeEmail(customerEmail);

            const cleanCustomerName =
                String(customerName || "").trim();

            const cleanOrderNumber =
                String(orderNumber || "").trim();

            const cleanReason =
                String(reason || "").trim();

            const cleanLocale =
                String(locale || "")
                    .trim()
                    .toLowerCase();

            if (
                !cleanCustomerEmail ||
                !cleanCustomerName ||
                !cleanOrderNumber
            ) {
                return res.status(400).json({
                    error:
                        "Customer name, email address and order number are required.",
                });
            }

            if (
                !isValidEmail(cleanCustomerEmail) ||
                cleanCustomerEmail.length > 254 ||
                cleanCustomerName.length > 120 ||
                cleanOrderNumber.length > 64 ||
                cleanReason.length > 2000 ||
                cleanLocale.length > 10
            ) {
                return res.status(400).json({
                    error: "Invalid submission details.",
                });
            }

            const shop =
                await prisma.shop.findUnique({
                    where: {
                        // Comes only from the verified Shopify app proxy.
                        shopDomain: req.shopDomain,
                    },
                });

            if (!shop || shop.uninstalledAt) {
                return res.status(404).json({
                    error: "Shop is not installed.",
                });
            }

            console.log("Withdrawal submission", {
                shopId: shop.id,
                shopDomain: shop.shopDomain,
            });

            let order;
            let verificationStatus = "UNVERIFIED";

            try {
                const accessToken =
                    await getValidOfflineToken(shop);

                const client =
                    new shopify.clients.Graphql({
                        session: {
                            shop: shop.shopDomain,
                            accessToken,
                        },
                    });

                const orderNumberForSearch =
                    cleanOrderNumber.replace(/^#/, "");

                const response = await client.request(
                    `
            query VerifyOrder($query: String!) {
              orders(first: 2, query: $query) {
                nodes {
                  id
                  name
                  createdAt
                  cancelledAt
                  test
                }
              }
            }
          `,
                    {
                        variables: {
                            query: `name:${JSON.stringify(
                                `#${orderNumberForSearch}`
                            )}`,
                        },
                    }
                );

                const possibleOrders =
                    response?.data?.orders?.nodes ?? [];

                const foundOrder =
                    possibleOrders.find((candidate) => {
                        return (
                            normalizeOrderNumber(
                                candidate.name
                            ) ===
                            normalizeOrderNumber(
                                cleanOrderNumber
                            )
                        );
                    });

                if (
                    !foundOrder ||
                    foundOrder.test === true ||
                    foundOrder.cancelledAt
                ) {
                    return res.status(422).json({
                        error:
                            "We could not verify the order number provided.",
                    });
                }

                order = foundOrder;

                const orderDate =
                    new Date(order.createdAt);

                const orderDateMs =
                    orderDate.getTime();

                if (Number.isNaN(orderDateMs)) {
                    return res.status(503).json({
                        error:
                            "We could not verify the order date. Please try again later.",
                    });
                }

                const diffDays =
                    (Date.now() - orderDateMs) /
                    86_400_000;

                const withdrawalDays =
                    shop.withdrawalDays || 14;

                /*
                 * The order exists, but ownership of the submitted
                 * email cannot be verified until Shopify grants
                 * protected access to the Order.email field.
                 */
                verificationStatus =
                    diffDays > withdrawalDays
                        ? "EXPIRED"
                        : "UNVERIFIED";
            } catch (error) {
                console.error(
                    "Shopify order verification failed:",
                    {
                        shopDomain: shop.shopDomain,
                        message: error?.message,
                    }
                );

                return res.status(503).json({
                    error:
                        "We could not verify the order. Please try again later.",
                });
            }

            /*
             * Temporary duplicate protection:
             * one recorded request per shop and Shopify order.
             */
            const submissionKey = crypto
                .createHash("sha256")
                .update(`${shop.id}:${order.id}`)
                .digest("hex");

            const publicReference =
                `WD-${nanoid(10).toUpperCase()}`;

            let requestRecord;

            try {
                requestRecord =
                    await prisma.withdrawalRequest.create({
                        data: {
                            shopId: shop.id,
                            publicReference,

                            /*
                             * This is the email entered by the customer.
                             * It is stored for merchant review only and
                             * must not be treated as Shopify-verified.
                             */
                            customerEmail:
                            cleanCustomerEmail,

                            customerName:
                            cleanCustomerName,

                            orderNumber: order.name,
                            orderId: order.id,

                            verificationStatus,

                            reason:
                                cleanReason || null,

                            locale:
                                cleanLocale ||
                                shop.locale ||
                                "en",

                            legalCopyVersion:
                                process.env
                                    .LEGAL_COPY_VERSION ||
                                "v1",

                            metadataJson:
                                JSON.stringify({
                                    source:
                                        "SHOPIFY_APP_PROXY",

                                    verifiedShopDomain:
                                    req.shopDomain,

                                    orderNumberVerified:
                                        true,

                                    customerEmailVerified:
                                        false,

                                    emailDeliveryDisabled:
                                        true,
                                }),

                            submissionKey,
                            emailStatus: "DISABLED",
                        },
                    });
            } catch (error) {
                /*
                 * The unique submissionKey prevents two requests
                 * for the same order from creating two records.
                 */
                if (error?.code === "P2002") {
                    const existingRequest =
                        await prisma.withdrawalRequest
                            .findUnique({
                                where: {
                                    submissionKey,
                                },
                                select: {
                                    publicReference: true,
                                    status: true,
                                    emailStatus: true,
                                },
                            });

                    if (existingRequest) {
                        return res.status(200).json({
                            ok: true,

                            reference:
                            existingRequest
                                .publicReference,

                            status:
                            existingRequest.status,

                            duplicate: true,

                            message:
                                "A withdrawal request for this order has already been recorded.",
                        });
                    }
                }

                throw error;
            }

            /*
             * IMPORTANT:
             * No customer confirmation or merchant-notification
             * email is sent in this temporary mode.
             *
             * Keep the Resend key revoked.
             */

            return res.status(201).json({
                ok: true,
                reference: publicReference,
                status: requestRecord.status,

                message:
                    "Your request has been recorded. The merchant will verify the details and contact you directly.",
            });
        } catch (error) {
            console.error(
                "Withdrawal request failed:",
                {
                    message: error?.message,
                }
            );

            const isDatabaseError =
                error?.name ===
                "PrismaClientInitializationError" ||
                error?.message?.includes(
                    "Can't reach database server"
                );

            return res
                .status(
                    isDatabaseError ? 503 : 500
                )
                .json({
                    error: isDatabaseError
                        ? "Temporary server issue. Please try again in a few minutes."
                        : "Could not create withdrawal request.",
                });
        }
    }
);

proxyRouter.get(
    "/settings",
    async (req, res) => {
        try {
            const shopDomain =
                req.shopDomain;

            const shop =
                await prisma.shop.findUnique({
                    where: {
                        shopDomain,
                    },
                });

            if (!shop || shop.uninstalledAt) {
                return res.json({
                    withdrawalDays: 14,
                    legalPageUrl: null,
                    privacyPageUrl: null,
                    supportEmail: null,
                    showPoweredBy: true,
                    poweredByText:
                        "Powered by GL6",

                    emailConfirmationsEnabled:
                        false,
                });
            }

            const isPro =
                shop.plan === "PRO";

            const defaultFreeLanguages = [
                "en",
                "de",
            ];

            let enabledLanguages =
                defaultFreeLanguages;

            try {
                enabledLanguages =
                    shop.enabledLanguages
                        ? JSON.parse(
                            shop.enabledLanguages
                        )
                        : defaultFreeLanguages;
            } catch {
                enabledLanguages =
                    defaultFreeLanguages;
            }

            if (
                !Array.isArray(
                    enabledLanguages
                ) ||
                enabledLanguages.length === 0
            ) {
                enabledLanguages =
                    defaultFreeLanguages;
            }

            // Free users: English plus up to three additional languages.
            if (!isPro) {
                if (
                    !enabledLanguages.includes(
                        "en"
                    )
                ) {
                    enabledLanguages = [
                        "en",
                        ...enabledLanguages,
                    ];
                }

                enabledLanguages = [
                    ...new Set(
                        enabledLanguages
                    ),
                ].slice(0, 4);
            }

            let defaultLanguage =
                shop.locale || "en";

            if (
                !enabledLanguages.includes(
                    defaultLanguage
                )
            ) {
                defaultLanguage =
                    enabledLanguages.includes(
                        "en"
                    )
                        ? "en"
                        : enabledLanguages[0];
            }

            return res.json({
                withdrawalDays:
                    isPro
                        ? shop.withdrawalDays ||
                        14
                        : 14,

                legalPageUrl:
                    shop.legalPageUrl || null,

                privacyPageUrl:
                    shop.privacyPageUrl || null,

                supportEmail:
                    shop.supportEmail || null,

                showPoweredBy: !isPro,
                poweredByText:
                    "Powered by GL6",

                defaultLanguage,
                enabledLanguages,
                isPro,

                /*
                 * The form remains available, but no automatic
                 * customer confirmation is currently sent.
                 */
                emailConfirmationsEnabled:
                    false,
            });
        } catch (error) {
            console.error(
                "Proxy settings error:",
                {
                    message: error?.message,
                }
            );

            return res.status(500).json({
                error:
                    "Could not load settings",

                withdrawalDays: 14,
                legalPageUrl: null,
                privacyPageUrl: null,
                supportEmail: null,
                showPoweredBy: true,
                poweredByText:
                    "Powered by GL6",

                emailConfirmationsEnabled:
                    false,
            });
        }
    }
);