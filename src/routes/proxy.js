import express from "express";
import { verifyAppProxy } from "../middleware/verifyAppProxy.js";
import {getValidOfflineToken} from "../lib/offlineTokens.js";
import {shopify} from "../lib/shopify.js";
import {sendCustomerConfirmation} from "../lib/merchantEmail.js";
import {sendEmail} from "../lib/email.js";
import { nanoid } from "nanoid";
import { prisma } from "../lib/db.js";
import crypto from "node:crypto";

export const proxyRouter = express.Router();

proxyRouter.use(verifyAppProxy);

proxyRouter.post('/withdrawal-request', async (req, res) => {
    if (process.env.WITHDRAWAL_EMAILS_DISABLED === "true") {
        return res.status(503).json({
            error: "Withdrawal submissions are temporarily unavailable."
        });
    }

    try {
        const {
            customerEmail,
            customerName,
            orderNumber,
            reason,
            locale
        } = req.body ?? {};

        const normalizeEmail = (value) =>
            String(value || "").trim().toLowerCase();

        const normalizeOrderNumber = (value) =>
            String(value || "")
                .trim()
                .replace(/^#/, "")
                .toLowerCase();

        const cleanCustomerEmail =
            normalizeEmail(customerEmail);

        const cleanCustomerName =
            String(customerName || "").trim();

        const cleanOrderNumber =
            String(orderNumber || "").trim();

        const cleanReason =
            String(reason || "").trim();

        if (
            !cleanCustomerEmail ||
            !cleanCustomerName ||
            !cleanOrderNumber
        ) {
            return res.status(400).json({
                error:
                    "Customer name, email address and order number are required."
            });
        }

        const shop = await prisma.shop.findUnique({
            where: {
                // Comes only from the verified Shopify app proxy.
                shopDomain: req.shopDomain
            }
        });

        if (!shop || shop.uninstalledAt) {
            return res.status(404).json({
                error: "Shop is not installed"
            });
        }

        console.log("Withdrawal submission", {
            shopId: shop.id,
            shopDomain: shop.shopDomain
        });

        let order;
        let verifiedRecipient;
        let verificationStatus;

        try {
            const accessToken =
                await getValidOfflineToken(shop);

            const client =
                new shopify.clients.Graphql({
                    session: {
                        shop: shop.shopDomain,
                        accessToken
                    }
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
            email
            createdAt
            cancelledAt
            test
          }
        }
      }
    `,
                {
                    variables: {
                        query:
                            `name:${JSON.stringify(
                                `#${orderNumberForSearch}`
                            )}`
                    }
                }
            );

            const possibleOrders =
                response?.data?.orders?.nodes ?? [];

            const foundOrder =
                possibleOrders.find((candidate) => {
                    return (
                        normalizeOrderNumber(candidate.name) ===
                        normalizeOrderNumber(cleanOrderNumber) &&
                        normalizeEmail(candidate.email) ===
                        cleanCustomerEmail
                    );
                });

            if (
                !foundOrder ||
                !foundOrder.email ||
                foundOrder.test === true ||
                foundOrder.cancelledAt
            ) {
                return res.status(422).json({
                    error:
                        "We could not verify the order details provided."
                });
            }

            order = foundOrder;

            // This is now confirmed against Shopify.
            verifiedRecipient =
                normalizeEmail(foundOrder.email);

            const orderDate =
                new Date(order.createdAt);

            const diffDays =
                (Date.now() - orderDate.getTime()) /
                86_400_000;

            const withdrawalDays =
                shop.withdrawalDays || 14;

            verificationStatus =
                diffDays > withdrawalDays
                    ? "EXPIRED"
                    : "VERIFIED";

        } catch (err) {
            console.error("Shopify order verification failed:", {
                shopDomain: shop.shopDomain,
                message: err?.message
            });

            // Never continue to email when verification fails.
            return res.status(503).json({
                error:
                    "We could not verify the order. Please try again later."
            });
        }

        const submissionKey = crypto
            .createHash("sha256")
            .update(
                `${shop.id}:${order.id}:${verifiedRecipient}`
            )
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

                        customerEmail: verifiedRecipient,
                        customerName: cleanCustomerName,

                        orderNumber: order.name,
                        orderId: order.id,

                        verificationStatus,
                        reason: cleanReason || null,
                        locale: locale || shop.locale || "en",

                        legalCopyVersion:
                            process.env.LEGAL_COPY_VERSION || "v1",

                        metadataJson: JSON.stringify({
                            source: "SHOPIFY_APP_PROXY",
                            verifiedShopDomain: req.shopDomain,
                        }),

                        submissionKey,
                        emailStatus: "PENDING",
                    },
                });
        } catch (error) {
            /*
             * P2002 means another request already created a
             * record with this unique submissionKey.
             */
            if (error?.code === "P2002") {
                const existingRequest =
                    await prisma.withdrawalRequest.findUnique({
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
                        existingRequest.publicReference,
                        status: existingRequest.status,
                        duplicate: true,
                    });
                }
            }

            throw error;
        }

        const template = await prisma.emailTemplate.findUnique({
            where: {
                shopId_code: {
                    shopId: shop.id,
                    code: "CONFIRMATION"
                }
            }
        });

        // let subject;
        // let bodyContent;
        //
        // if (template) {
        //     subject = template.subject;
        //
        //     bodyContent = template.bodyHtml
        //         .replace(/{{reference}}/g, publicReference)
        //         .replace(/{{shopName}}/g, shop.brandingName || shop.shopDomain)
        //         .replace(/{{customerEmail}}/g, cleanCustomerEmail)
        //         .replace(/{{customerName}}/g, cleanCustomerName);
        //
        // } else {
        //     const fallback = buildConfirmationEmail({
        //         shopName: shop.brandingName || shop.shopDomain,
        //         reference: publicReference,
        //         locale: requestRecord.locale
        //     });
        //
        //     subject = fallback.subject;
        //     bodyContent = fallback.html;
        // }

        const subject =
            `Withdrawal request received – ${publicReference}`;

        const html = `
  <div style="font-family:Arial,sans-serif;line-height:1.5">
    <h2>Withdrawal request received</h2>

    <p>
      A withdrawal request has been recorded for an order
      placed at <strong>${escapeHtml(shop.shopDomain)}</strong>.
    </p>

    <p>
      Reference:
      <strong>${escapeHtml(publicReference)}</strong>
    </p>

    <p>
      The merchant will review the request separately.
    </p>

    <hr>

    <p style="font-size:12px;color:#6b7280">
      This message confirms receipt of an EU withdrawal
      request. It will never request payment details,
      passwords, BankID information or identity documents.
    </p>
  </div>
`;

        try {
            await sendCustomerConfirmation({
                shop,
                to: verifiedRecipient,
                subject,
                html,
            });
        } catch (e) {
            console.warn(
                "Customer confirmation email failed:",
                e.message
            );
        }

        if (shop.merchantNotification) {
            try {
                if (process.env.EMAIL_DELIVERY_MODE === "log") {
                    console.log("TEST MODE: email not sent", {
                        requestId: requestRecord.id,
                        reference: publicReference,
                    });

                    await prisma.withdrawalRequest.update({
                        where: { id: requestRecord.id },
                        data: {
                            emailStatus: "TEST_SKIPPED",
                        },
                    });
                } else {
                    try {
                        const sendResult = await sendCustomerConfirmation({
                            shop,
                            to: verifiedRecipient,
                            subject,
                            html,
                        });

                        await prisma.withdrawalRequest.update({
                            where: { id: requestRecord.id },
                            data: {
                                emailStatus: "SENT",
                                confirmationSentAt: new Date(),
                                emailProviderId: sendResult?.id || null,
                            },
                        });
                    } catch (error) {
                        await prisma.withdrawalRequest.update({
                            where: { id: requestRecord.id },
                            data: {
                                emailStatus: "FAILED",
                            },
                        });

                        throw error;
                    }
                }
            } catch (error) {
                await prisma.withdrawalRequest
                    .update({
                        where: {
                            id: requestRecord.id,
                        },
                        data: {
                            emailStatus: "FAILED",
                        },
                    })
                    .catch((updateError) => {
                        console.error(
                            "Could not record email failure:",
                            updateError?.message
                        );
                    });

                console.warn(
                    "Customer confirmation email failed:",
                    error?.message
                );
            }
        }

        return res.status(201).json({
            ok: true,
            reference: publicReference,
            status: requestRecord.status
        });
    } catch (err) {
        console.error("❌ DB ERROR:", err);

        const isDatabaseError =
            err?.name === "PrismaClientInitializationError" ||
            err?.message?.includes("Can't reach database server");

        return res.status(isDatabaseError ? 503 : 500).json({
            error: isDatabaseError
                ? "Temporary server issue. Please try again in a few minutes."
                : "Could not create withdrawal request"
        });
    }
});

proxyRouter.get('/settings', async (req, res) => {
    try {
        const shopDomain = req.shopDomain;

        const shop = await prisma.shop.findUnique({
            where: { shopDomain }
        });

        if (!shop || shop.uninstalledAt) {
            return res.json({
                withdrawalDays: 14,
                legalPageUrl: null,
                privacyPageUrl: null,
                supportEmail: null,
                showPoweredBy: true,
                poweredByText: "Powered by GL6"
            });
        }

        const isPro = shop.plan === "PRO";

        const defaultFreeLanguages = ["en", "de"];

        let enabledLanguages = defaultFreeLanguages;

        try {
            enabledLanguages = shop.enabledLanguages
                ? JSON.parse(shop.enabledLanguages)
                : defaultFreeLanguages;
        } catch {
            enabledLanguages = defaultFreeLanguages;
        }

        if (!Array.isArray(enabledLanguages) || enabledLanguages.length === 0) {
            enabledLanguages = defaultFreeLanguages;
        }

// Free users: English + up to 3 additional languages
        if (!isPro) {
            if (!enabledLanguages.includes("en")) {
                enabledLanguages = ["en", ...enabledLanguages];
            }

            enabledLanguages = [...new Set(enabledLanguages)].slice(0, 4);
        }

        let defaultLanguage = shop.locale || "en";

        if (!enabledLanguages.includes(defaultLanguage)) {
            defaultLanguage = enabledLanguages.includes("en") ? "en" : enabledLanguages[0];
        }

        return res.json({
            withdrawalDays: isPro ? shop.withdrawalDays || 14 : 14,
            legalPageUrl: shop.legalPageUrl || null,
            privacyPageUrl: shop.privacyPageUrl || null,
            supportEmail: shop.supportEmail || null,
            showPoweredBy: !isPro,
            poweredByText: "Powered by GL6",

            defaultLanguage,
            enabledLanguages,
            isPro
        });
    } catch (err) {
        console.error("Public settings error:", err);

        return res.status(500).json({
            error: "Could not load settings",
            withdrawalDays: 14,
            legalPageUrl: null,
            privacyPageUrl: null,
            supportEmail: null,
            showPoweredBy: true,
            poweredByText: "Powered by GL6"
        });
    }
});