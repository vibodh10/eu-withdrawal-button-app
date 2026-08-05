import express from 'express';
import { prisma } from '../lib/db.js';
import { toCsv } from '../lib/csv.js';
import { isPro, PLANS } from '../lib/plans.js';
import verifyRequest from "../middleware/verifyRequest.js";
import { buildManagedPricingUrl } from '../lib/shopify.js';
import {exchangeOfflineToken, getValidOfflineToken} from "../lib/offlineTokens.js";
import {buildConfirmationEmail} from "../lib/email.js";
import { encryptSecret } from "../lib/encryption.js";
import { verifyMerchantSmtp } from "../lib/merchantEmail.js";
import { Resend } from "resend";
import {
    recordDataAccess
} from "../lib/dataAccessAudit.js";

export const adminRouter = express.Router();
const resend =
    new Resend(
        process.env.RESEND_API_KEY
    );

function publicSmtpSettings(shop) {
  return {
    smtpEnabled: Boolean(shop.smtpEnabled),
    smtpHost: shop.smtpHost || "",
    smtpPort: shop.smtpPort || 587,
    smtpSecure: Boolean(shop.smtpSecure),
    smtpUsername: shop.smtpUsername || "",
    smtpFromName: shop.smtpFromName || "",
    smtpFromEmail: shop.smtpFromEmail || "",

    // Never return the encrypted password.
    smtpHasPassword: Boolean(
        shop.smtpPasswordEncrypted
    ),

    smtpVerifiedAt:
        shop.smtpVerifiedAt || null,

    smtpLastError:
        shop.smtpLastError || null,

      merchantNotification:
          shop.merchantNotification || null,

      currentPlanHandle:
          shop.currentPlanHandle || null,

      currentSubscriptionStatus:
          shop.currentSubscriptionStatus || null,
  };
}

function publicResendDomainSettings(shop) {
  return {
    emailDeliveryMethod:
        shop.emailDeliveryMethod ||
        "GL6",

    resendDomainId:
        shop.resendDomainId ||
        null,

    resendDomainName:
        shop.resendDomainName ||
        "",

    resendDomainStatus:
        shop.resendDomainStatus ||
        null,

    resendFromEmail:
        shop.resendFromEmail ||
        "",

    resendFromName:
        shop.resendFromName ||
        "",

    resendDomainCreatedAt:
        shop.resendDomainCreatedAt ||
        null,

    resendDomainVerifiedAt:
        shop.resendDomainVerifiedAt ||
        null,

    resendDomainLastError:
        shop.resendDomainLastError ||
        null,
  };
}

function publicShopView(shop) {
    return {
        id: shop.id,
        shopDomain: shop.shopDomain,
        plan: shop.plan,
        locale: shop.locale,
        enabledLanguages: parseEnabledLanguages(
            shop.enabledLanguages
        ),
        brandingName: shop.brandingName,
        brandingPrimaryColor:
        shop.brandingPrimaryColor,
        withdrawalDays: shop.withdrawalDays,
        legalPageUrl: shop.legalPageUrl,
        privacyPageUrl: shop.privacyPageUrl,
        supportEmail: shop.supportEmail,
        dpaAcceptedAt: shop.dpaAcceptedAt,
    };
}

function normalizeEmail(value) {
    return String(value || "")
        .trim()
        .toLowerCase();
}

// ✅ ONE AUTH LAYER
adminRouter.use(verifyRequest);

adminRouter.get("/me", async (req, res) => {
    const shop = req.shop;

    return res.json({
        shop: {
            ...publicShopView(shop),
            ...publicSmtpSettings(shop),
            ...publicResendDomainSettings(shop),
        },

        plans: PLANS,
        isPro: isPro(shop),

        managedPricing: {
            enabled: true,
            pricingUrl:
                buildManagedPricingUrl(
                    shop.shopDomain
                ),
        },
    });
});

adminRouter.get(
    "/requests",
    async (req, res) => {
        try {
            const shop = req.shop;

            const requestedLimit =
                Number.parseInt(
                    req.query.limit,
                    10
                );

            const limit = Math.min(
                Math.max(
                    Number.isInteger(requestedLimit)
                        ? requestedLimit
                        : 100,
                    1
                ),
                100
            );

            const requests =
                await prisma.withdrawalRequest.findMany({
                    where: {
                        shopId: shop.id,
                    },
                    orderBy: {
                        createdAt: "desc",
                    },
                    take: limit,
                });

            await recordDataAccess({
                shopId: shop.id,
                action:
                    "WITHDRAWAL_LIST_VIEWED",
                recordCount: requests.length,
                actorType: "MERCHANT_ADMIN",
            });

            return res.json({
                requests,
            });
        } catch (error) {
            console.error(
                "Load withdrawal requests failed:",
                error?.message
            );

            return res.status(500).json({
                error:
                    "Could not load withdrawal requests.",
            });
        }
    }
);

adminRouter.get('/analytics/summary', async (req, res) => {
  const shop = req.shop;

  const rows = await prisma.withdrawalRequest.findMany({
    where: { shopId: shop.id },
    select: { status: true }
  });

  const summary = rows.reduce((acc, row) => {
    acc.total += 1;
    const key = row.status.toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, { total: 0, received: 0, confirmed: 0, reviewed: 0, approved: 0, rejected: 0 });

  res.json({ summary });
});

adminRouter.patch(
    "/requests/:id",
    async (req, res) => {
        try {
            const shop = req.shop;

            const allowedStatuses = [
                "RECEIVED",
                "CONFIRMED",
                "REVIEWED",
                "APPROVED",
                "REJECTED",
            ];

            const newStatus =
                String(req.body.status || "")
                    .trim()
                    .toUpperCase();

            if (
                !allowedStatuses.includes(
                    newStatus
                )
            ) {
                return res.status(400).json({
                    error: "Invalid status",
                });
            }

            const updated =
                await prisma.$transaction(
                    async (tx) => {
                        const record =
                            await tx.withdrawalRequest
                                .findFirst({
                                    where: {
                                        id: req.params.id,
                                        shopId: shop.id,
                                    },
                                });

                        if (!record) {
                            return null;
                        }

                        const isFinal = [
                            "APPROVED",
                            "REJECTED",
                        ].includes(newStatus);

                        const result =
                            await tx.withdrawalRequest
                                .update({
                                    where: {
                                        id: record.id,
                                    },
                                    data: {
                                        status: newStatus,

                                        resolvedAt: isFinal
                                            ? record.resolvedAt ||
                                            new Date()
                                            : null,
                                    },
                                });

                        await recordDataAccess({
                            db: tx,
                            shopId: shop.id,
                            action:
                                "WITHDRAWAL_UPDATED",
                            recordId: record.id,
                            actorType:
                                "MERCHANT_ADMIN",

                            reason:
                                `Status changed from ${record.status} to ${newStatus}`,
                        });

                        return result;
                    }
                );

            if (!updated) {
                return res.status(404).json({
                    error: "Request not found",
                });
            }

            return res.json({
                request: updated,
            });
        } catch (error) {
            console.error(
                "Update withdrawal request failed:",
                error?.message
            );

            return res.status(500).json({
                error:
                    "Could not update withdrawal request.",
            });
        }
    }
);

adminRouter.get(
    "/export.csv",
    async (req, res) => {
        try {
            const shop = req.shop;

            if (!isPro(shop)) {
                return res.status(403).json({
                    error: "Upgrade to Pro",
                });
            }

            const rows =
                await prisma.withdrawalRequest
                    .findMany({
                        where: {
                            shopId: shop.id,
                        },
                        orderBy: {
                            createdAt: "desc",
                        },
                    });

            await recordDataAccess({
                shopId: shop.id,
                action:
                    "WITHDRAWAL_EXPORTED",
                recordCount: rows.length,
                actorType: "MERCHANT_ADMIN",
                reason:
                    "Merchant requested CSV export",
            });

            const csv = toCsv(rows);

            res.setHeader(
                "Content-Type",
                "text/csv; charset=utf-8"
            );

            res.setHeader(
                "Content-Disposition",
                'attachment; filename="withdrawal-requests.csv"'
            );

            res.setHeader(
                "Cache-Control",
                "private, no-store, max-age=0"
            );

            res.setHeader(
                "Pragma",
                "no-cache"
            );

            return res
                .status(200)
                .send(csv);
        } catch (error) {
            console.error(
                "Export withdrawal requests failed:",
                error?.message
            );

            return res.status(500).json({
                error:
                    "Could not export withdrawal requests.",
            });
        }
    }
);

const SUPPORTED_LANGUAGES = new Set([
  "en",
  "de",
  "fr",
  "it",
  "es",
  "pt",
  "nl",
  "pl",
  "da",
  "sv",
  "fi",
  "cs",
  "sk",
  "sl",
  "hr",
  "hu",
  "ro",
  "bg",
  "el",
  "et",
  "lv",
  "lt",
  "ga",
  "mt",
]);

const DEFAULT_ENABLED_LANGUAGES = ["en", "de"];

function normaliseLanguageCode(value) {
  return String(value || "")
      .trim()
      .toLowerCase()
      .split("-")[0];
}

function parseEnabledLanguages(value) {
  if (Array.isArray(value)) {
    return value;
  }

  try {
    const parsed = JSON.parse(value || "[]");

    return Array.isArray(parsed)
        ? parsed
        : [...DEFAULT_ENABLED_LANGUAGES];
  } catch {
    return [...DEFAULT_ENABLED_LANGUAGES];
  }
}

adminRouter.patch("/settings", async (req, res) => {
  try {
    const shop = req.shop;

    if (!shop) {
      return res.status(401).json({
        error: "Shop not found",
      });
    }

    const shopIsPro = isPro(shop);

    /*
     * Language settings
     */

    const currentlyEnabled = parseEnabledLanguages(
        shop.enabledLanguages
    );

    const submittedLanguages =
        req.body.enabledLanguages !== undefined
            ? req.body.enabledLanguages
            : currentlyEnabled;

    if (!Array.isArray(submittedLanguages)) {
      return res.status(400).json({
        error: "enabledLanguages must be an array",
      });
    }

    let enabledLanguages = [
      ...new Set(
          submittedLanguages
              .map(normaliseLanguageCode)
              .filter((code) => SUPPORTED_LANGUAGES.has(code))
      ),
    ];

    if (enabledLanguages.length === 0) {
      enabledLanguages = [...DEFAULT_ENABLED_LANGUAGES];
    }

    if (!shopIsPro) {
      // English is compulsory on Basic.
      if (!enabledLanguages.includes("en")) {
        enabledLanguages.unshift("en");
      }

      enabledLanguages = [...new Set(enabledLanguages)];

      // English plus a maximum of three additional languages.
      if (enabledLanguages.length > 2) {
        return res.status(400).json({
          error:
              "The Basic plan includes English plus 1 additional language.",
        });
      }
    }

    let locale = normaliseLanguageCode(
        req.body.locale ?? shop.locale ?? "en"
    );

    // Default language must be supported and enabled.
    if (
        !SUPPORTED_LANGUAGES.has(locale) ||
        !enabledLanguages.includes(locale)
    ) {
      locale = enabledLanguages.includes("en")
          ? "en"
          : enabledLanguages[0];
    }

    /*
     * General settings
     */

    const patch = {
      brandingName: req.body.brandingName,
      locale,
      enabledLanguages: JSON.stringify(enabledLanguages),
      merchantNotification: req.body.merchantNotification,
      legalPageUrl: req.body.legalPageUrl,
      privacyPageUrl: req.body.privacyPageUrl,
      supportEmail: req.body.supportEmail,
      emailDeliveryMethod:
          shopIsPro &&
          ["GL6", "SMTP", "RESEND_DOMAIN"].includes(
              req.body.emailDeliveryMethod
          )
              ? req.body.emailDeliveryMethod
              : "GL6",
    };

    /*
     * Pro-only settings
     */

    if (shopIsPro) {
      if (req.body.brandingPrimaryColor !== undefined) {
        patch.brandingPrimaryColor =
            req.body.brandingPrimaryColor;
      }

      if (req.body.withdrawalDays !== undefined) {
        const withdrawalDays = Number.parseInt(
            req.body.withdrawalDays,
            10
        );

        if (
            !Number.isInteger(withdrawalDays) ||
            withdrawalDays < 1 ||
            withdrawalDays > 365
        ) {
          return res.status(400).json({
            error:
                "Withdrawal period must be between 1 and 365 days.",
          });
        }

        patch.withdrawalDays = withdrawalDays;
      }
    }

    const cleaned = Object.fromEntries(
        Object.entries(patch).filter(
            ([, value]) => value !== undefined
        )
    );

    const updated = await prisma.shop.update({
      where: {
        id: shop.id,
      },
      data: cleaned,
    });

      return res.json({
          shop: publicShopView(updated),
      });
  } catch (error) {
    console.error("Update settings failed:", error);

    return res.status(500).json({
      error: "Could not update settings",
    });
  }
});

adminRouter.delete(
    "/delete-customer",
    async (req, res) => {
        try {
            const shop = req.shop;

            const email =
                normalizeEmail(req.body.email);

            if (
                !email ||
                !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
                    email
                )
            ) {
                return res.status(400).json({
                    error:
                        "A valid email address is required.",
                });
            }

            const result =
                await prisma.$transaction(
                    async (tx) => {
                        const deleted =
                            await tx.withdrawalRequest
                                .deleteMany({
                                    where: {
                                        shopId: shop.id,
                                        customerEmail: email,
                                    },
                                });

                        await recordDataAccess({
                            db: tx,
                            shopId: shop.id,
                            action:
                                "CUSTOMER_DATA_DELETED",
                            recordCount:
                            deleted.count,
                            actorType:
                                "MERCHANT_ADMIN",
                            reason:
                                "Manual customer-data deletion",
                        });

                        return deleted;
                    }
                );

            return res.json({
                success: true,
                deleted: result.count,
            });
        } catch (error) {
            console.error(
                "Customer deletion failed:",
                error?.message
            );

            return res.status(500).json({
                error:
                    "Could not delete customer data.",
            });
        }
    }
);

adminRouter.post('/dpa/accept', async (req, res) => {
  const shop = req.shop;

  await prisma.shop.update({
    where: { id: shop.id },
    data: {
      dpaAcceptedAt: new Date()
    }
  });

  res.json({ success: true });
});

// GET /admin/email-templates
adminRouter.get('/email-templates', async (req, res) => {
  const shop = req.shop;

  const templates = await prisma.emailTemplate.findMany({
    where: { shopId: shop.id }
  });

  res.json({ templates });
});

// PATCH /admin/email-templates/:code
adminRouter.patch(
    "/email-templates/:code",
    (_req, res) => {
        return res.status(410).json({
            error:
                "Custom email templates are disabled for security.",
        });
    }
);

adminRouter.delete(
    "/requests/:id",
    async (req, res) => {
        try {
            const shop = req.shop;

            const deleted =
                await prisma.$transaction(
                    async (tx) => {
                        const record =
                            await tx.withdrawalRequest
                                .findFirst({
                                    where: {
                                        id: req.params.id,
                                        shopId: shop.id,
                                    },
                                });

                        if (!record) {
                            return null;
                        }

                        await tx.withdrawalRequest
                            .delete({
                                where: {
                                    id: record.id,
                                },
                            });

                        await recordDataAccess({
                            db: tx,
                            shopId: shop.id,
                            action:
                                "WITHDRAWAL_DELETED",
                            recordId: record.id,
                            recordCount: 1,
                            actorType:
                                "MERCHANT_ADMIN",
                            reason:
                                "Merchant deleted withdrawal request",
                        });

                        return record.id;
                    }
                );

            if (!deleted) {
                return res.status(404).json({
                    error: "Request not found",
                });
            }

            return res.json({
                success: true,
            });
        } catch (error) {
            console.error(
                "Delete withdrawal request failed:",
                error?.message
            );

            return res.status(500).json({
                error:
                    "Could not delete withdrawal request.",
            });
        }
    }
);

adminRouter.post("/setup/withdrawal-page", async (req, res) => {
  try {
    const shop = req.shop;

    if (!shop) {
      return res.status(401).json({
        error: "No shop found on request",
      });
    }

    const accessToken = await getValidOfflineToken(shop);

    const query = `
      query ExistingWithdrawalPage($query: String!) {
        pages(first: 1, query: $query) {
          edges {
            node {
              id
              title
              handle
            }
          }
        }
      }
    `;

    const searchResponse = await fetch(
        `https://${shop.shopDomain}/admin/api/2026-04/graphql.json`,
        {
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": accessToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query,
            variables: {
              query: "handle:eu-withdrawal",
            },
          }),
        }
    );

    const searchData = await searchResponse.json();

    const existingPage = searchData?.data?.pages?.edges?.[0]?.node;

    if (existingPage) {
      return res.json({
        success: true,
        alreadyExists: true,
        page: existingPage,
        url: `https://${shop.shopDomain}/pages/${existingPage.handle}`,
      });
    }

    const mutation = `
      mutation CreateWithdrawalPage($page: PageCreateInput!) {
        pageCreate(page: $page) {
          page {
            id
            title
            handle
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const createResponse = await fetch(
        `https://${shop.shopDomain}/admin/api/2026-04/graphql.json`,
        {
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": accessToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: mutation,
            variables: {
              page: {
                title: "EU Withdrawal Request",
                handle: "eu-withdrawal",
                isPublished: true,
                body: `
                <p>If you are an eligible EU customer and wish to submit a withdrawal request, please use the withdrawal button or form on this page.</p>
                <p>If the form is not visible, please contact the store directly.</p>
              `,
              },
            },
          }),
        }
    );

    const createData = await createResponse.json();

    const errors = createData?.data?.pageCreate?.userErrors || [];

    if (errors.length > 0) {
      return res.status(400).json({
        error: errors.map((e) => e.message).join(", "),
      });
    }

    const page = createData?.data?.pageCreate?.page;

    return res.json({
      success: true,
      alreadyExists: false,
      page,
      url: `https://${shop.shopDomain}/pages/${page.handle}`,
    });
  } catch (err) {
    console.error("Create withdrawal page failed:", err);

    return res.status(500).json({
      error: err.message || "Could not create withdrawal page",
    });
  }
});

adminRouter.get("/smtp", async (req, res) => {
  try {
    const shop = req.shop;

    if (!isPro(shop)) {
      return res.status(403).json({
        error:
            "Custom SMTP is available on the Pro plan.",
      });
    }

    const latestShop =
        await prisma.shop.findUnique({
          where: {
            id: shop.id,
          },
        });

    if (!latestShop) {
      return res.status(404).json({
        error: "Shop not found.",
      });
    }

    return res.json({
      settings:
          publicSmtpSettings(latestShop),
    });
  } catch (error) {
    console.error(
        "Load SMTP settings failed:",
        error
    );

    return res.status(500).json({
      error:
          "Could not load SMTP settings.",
    });
  }
});

adminRouter.patch("/smtp", async (req, res) => {
  try {
    const shop = req.shop;

    if (!isPro(shop)) {
      return res.status(403).json({
        error:
            "Custom SMTP is available on the Pro plan.",
      });
    }

    const {
      smtpEnabled,
      smtpHost,
      smtpPort,
      smtpSecure,
      smtpUsername,
      smtpPassword,
      smtpFromName,
      smtpFromEmail,
    } = req.body;

    const enabled =
        Boolean(smtpEnabled);

    const host =
        String(smtpHost || "").trim();

    const username =
        String(smtpUsername || "").trim();

    const fromName =
        String(smtpFromName || "").trim();

    const fromEmail =
        String(smtpFromEmail || "").trim();

    const password =
        typeof smtpPassword === "string"
            ? smtpPassword.trim()
            : "";

    const port =
        Number.parseInt(smtpPort, 10);

    if (enabled) {
      if (!host) {
        return res.status(400).json({
          error: "SMTP host is required.",
        });
      }

      if (
          !Number.isInteger(port) ||
          port < 1 ||
          port > 65535
      ) {
        return res.status(400).json({
          error:
              "Enter a valid SMTP port.",
        });
      }

      if (!username) {
        return res.status(400).json({
          error:
              "SMTP username is required.",
        });
      }

      if (!fromEmail) {
        return res.status(400).json({
          error:
              "From email is required.",
        });
      }

      const hasExistingPassword =
          Boolean(
              shop.smtpPasswordEncrypted
          );

      if (
          !password &&
          !hasExistingPassword
      ) {
        return res.status(400).json({
          error:
              "SMTP password is required.",
        });
      }
    }

    const patch = {
      smtpEnabled: enabled,

      smtpHost:
          host || null,

      smtpPort:
          Number.isInteger(port)
              ? port
              : null,

      smtpSecure:
          Boolean(smtpSecure),

      smtpUsername:
          username || null,

      smtpFromName:
          fromName || null,

      smtpFromEmail:
          fromEmail || null,

      /*
       * Any configuration change means the
       * connection must be tested again.
       */
      smtpVerifiedAt: null,
      smtpLastError: null,
    };

    /*
     * A blank password means:
     * keep the currently saved password.
     */
    if (password) {
      patch.smtpPasswordEncrypted =
          encryptSecret(password);
    }

    const updated =
        await prisma.shop.update({
          where: {
            id: shop.id,
          },
          data: patch,
        });

    return res.json({
      ok: true,
      settings:
          publicSmtpSettings(updated),
    });
  } catch (error) {
    console.error(
        "Save SMTP settings failed:",
        error
    );

    return res.status(500).json({
      error:
          "Could not save SMTP settings.",
    });
  }
});

adminRouter.post(
    "/smtp/test",
    async (req, res) => {
      try {
        const shop = req.shop;

        if (!isPro(shop)) {
          return res.status(403).json({
            error:
                "Custom SMTP is available on the Pro plan.",
          });
        }

        const latestShop =
            await prisma.shop.findUnique({
              where: {
                id: shop.id,
              },
            });

        if (!latestShop) {
          return res.status(404).json({
            error: "Shop not found.",
          });
        }

        if (!latestShop.smtpEnabled) {
          return res.status(400).json({
            error:
                "Enable custom SMTP and save the settings first.",
          });
        }

        await verifyMerchantSmtp(
            latestShop
        );

        const updated =
            await prisma.shop.update({
              where: {
                id: latestShop.id,
              },
              data: {
                smtpVerifiedAt:
                    new Date(),
                smtpLastError: null,
              },
            });

        return res.json({
          ok: true,
          message:
              "SMTP connection verified successfully.",
          settings:
              publicSmtpSettings(updated),
        });
      } catch (error) {
        console.error(
            "SMTP verification failed:",
            {
              shop:
              req.shop?.shopDomain,
              message:
              error.message,
            }
        );

        if (req.shop?.id) {
          await prisma.shop.update({
            where: {
              id: req.shop.id,
            },
            data: {
              smtpVerifiedAt: null,
              smtpLastError:
                  "Connection failed. Check your SMTP settings.",
            },
          });
        }

        return res.status(400).json({
          error:
              "Could not connect to the SMTP server. Check the host, port, security option and credentials.",
        });
      }
    }
);

adminRouter.delete("/smtp", async (req, res) => {
  try {
    const shop = req.shop;

    if (!isPro(shop)) {
      return res.status(403).json({
        error:
            "Custom SMTP is available on the Pro plan.",
      });
    }

    const updated =
        await prisma.shop.update({
          where: {
            id: shop.id,
          },
          data: {
            smtpEnabled: false,
            smtpHost: null,
            smtpPort: null,
            smtpSecure: false,
            smtpUsername: null,
            smtpPasswordEncrypted: null,
            smtpFromName: null,
            smtpFromEmail: null,
            smtpVerifiedAt: null,
            smtpLastError: null,
          },
        });

    return res.json({
      ok: true,
      settings:
          publicSmtpSettings(updated),
    });
  } catch (error) {
    console.error(
        "Disconnect SMTP failed:",
        error
    );

    return res.status(500).json({
      error:
          "Could not disconnect SMTP.",
    });
  }
});

adminRouter.post(
    "/resend-domain",
    async (req, res) => {
      try {
        const shop = req.shop;

        if (!isPro(shop)) {
          return res.status(403).json({
            error:
                "Verified sending domains are available on the Pro plan.",
          });
        }

        if (shop.resendDomainId) {
          return res.status(400).json({
            error:
                "A sending domain is already connected. Remove it before adding another.",
          });
        }

        const domainName =
            String(
                req.body.domainName || ""
            )
                .trim()
                .toLowerCase()
                .replace(/^https?:\/\//, "")
                .replace(/\/.*$/, "");

        if (!domainName) {
          return res.status(400).json({
            error:
                "Enter a domain or subdomain.",
          });
        }

        const { data, error } =
            await resend.domains.create({
              name: domainName,
            });

        if (error) {
          return res.status(400).json({
            error:
                error.message ||
                "Could not create the sending domain.",
          });
        }

        const updated =
            await prisma.shop.update({
              where: {
                id: shop.id,
              },
              data: {
                emailDeliveryMethod:
                    "RESEND_DOMAIN",

                resendDomainId:
                data.id,

                resendDomainName:
                    data.name ||
                    domainName,

                resendDomainStatus:
                    data.status ||
                    "not_started",

                resendDomainCreatedAt:
                    new Date(),

                resendDomainVerifiedAt:
                    null,

                resendDomainLastError:
                    null,
              },
            });

        return res.status(201).json({
          ok: true,

          settings:
              publicResendDomainSettings(
                  updated
              ),

          /*
           * Resend returns the required
           * DNS records in the domain response.
           */
          records:
              data.records || [],
        });
      } catch (error) {
        console.error(
            "Create Resend domain failed:",
            error
        );

        return res.status(500).json({
          error:
              "Could not create the sending domain.",
        });
      }
    }
);

adminRouter.get(
    "/resend-domain",
    async (req, res) => {
      try {
        const shop = req.shop;

        if (!isPro(shop)) {
          return res.status(403).json({
            error:
                "Verified sending domains are available on the Pro plan.",
          });
        }

        if (!shop.resendDomainId) {
          return res.json({
            settings:
                publicResendDomainSettings(
                    shop
                ),
            records: [],
          });
        }

        const { data, error } =
            await resend.domains.get(
                shop.resendDomainId
            );

        if (error) {
          return res.status(400).json({
            error:
                error.message ||
                "Could not retrieve the sending domain.",
          });
        }

        const status =
            String(
                data.status || ""
            ).toLowerCase();

        const verifiedAt =
            status === "verified"
                ? shop.resendDomainVerifiedAt ||
                new Date()
                : null;

        const updated =
            await prisma.shop.update({
              where: {
                id: shop.id,
              },
              data: {
                resendDomainStatus:
                    status || null,

                resendDomainVerifiedAt:
                verifiedAt,

                resendDomainLastError:
                    null,
              },
            });

        return res.json({
          settings:
              publicResendDomainSettings(
                  updated
              ),

          records:
              data.records || [],
        });
      } catch (error) {
        console.error(
            "Retrieve Resend domain failed:",
            error
        );

        return res.status(500).json({
          error:
              "Could not retrieve the sending domain.",
        });
      }
    }
);

adminRouter.post(
    "/resend-domain/verify",
    async (req, res) => {
      try {
        const shop = req.shop;

        if (!isPro(shop)) {
          return res.status(403).json({
            error:
                "Verified sending domains are available on the Pro plan.",
          });
        }

        if (!shop.resendDomainId) {
          return res.status(400).json({
            error:
                "Add a sending domain first.",
          });
        }

        const { data, error } =
            await resend.domains.verify(
                shop.resendDomainId
            );

        if (error) {
          await prisma.shop.update({
            where: {
              id: shop.id,
            },
            data: {
              resendDomainLastError:
                  error.message ||
                  "Verification could not be started.",
            },
          });

          return res.status(400).json({
            error:
                error.message ||
                "Could not start domain verification.",
          });
        }

        const updated =
            await prisma.shop.update({
              where: {
                id: shop.id,
              },
              data: {
                resendDomainStatus:
                    data?.status ||
                    "pending",

                resendDomainVerifiedAt:
                    null,

                resendDomainLastError:
                    null,
              },
            });

        return res.json({
          ok: true,

          message:
              "Domain verification has started.",

          settings:
              publicResendDomainSettings(
                  updated
              ),
        });
      } catch (error) {
        console.error(
            "Verify Resend domain failed:",
            error
        );

        return res.status(500).json({
          error:
              "Could not start domain verification.",
        });
      }
    }
);

adminRouter.patch(
    "/resend-domain/sender",
    async (req, res) => {
      try {
        const shop = req.shop;

        if (!isPro(shop)) {
          return res.status(403).json({
            error:
                "Verified sending domains are available on the Pro plan.",
          });
        }

        if (
            !shop.resendDomainId ||
            shop.resendDomainStatus !==
            "verified"
        ) {
          return res.status(400).json({
            error:
                "Verify the sending domain before configuring the sender.",
          });
        }

        const fromName =
            String(
                req.body.fromName || ""
            ).trim();

        const fromEmail =
            String(
                req.body.fromEmail || ""
            )
                .trim()
                .toLowerCase();

        if (!fromEmail) {
          return res.status(400).json({
            error:
                "Enter a sender email address.",
          });
        }

        const domainName =
            String(
                shop.resendDomainName || ""
            ).toLowerCase();

        if (
            !fromEmail.endsWith(
                `@${domainName}`
            )
        ) {
          return res.status(400).json({
            error:
                `The sender email must use @${domainName}.`,
          });
        }

        const updated =
            await prisma.shop.update({
              where: {
                id: shop.id,
              },
              data: {
                emailDeliveryMethod:
                    "RESEND_DOMAIN",

                resendFromName:
                    fromName || null,

                resendFromEmail:
                fromEmail,

                resendDomainLastError:
                    null,
              },
            });

        return res.json({
          ok: true,
          settings:
              publicResendDomainSettings(
                  updated
              ),
        });
      } catch (error) {
        console.error(
            "Save Resend sender failed:",
            error
        );

        return res.status(500).json({
          error:
              "Could not save the sender address.",
        });
      }
    }
);

adminRouter.delete(
    "/resend-domain",
    async (req, res) => {
      try {
        const shop = req.shop;

        if (!isPro(shop)) {
          return res.status(403).json({
            error:
                "Verified sending domains are available on the Pro plan.",
          });
        }

        if (shop.resendDomainId) {
          const { error } =
              await resend.domains.remove(
                  shop.resendDomainId
              );

          if (error) {
            return res.status(400).json({
              error:
                  error.message ||
                  "Could not remove the domain from Resend.",
            });
          }
        }

        const updated =
            await prisma.shop.update({
              where: {
                id: shop.id,
              },
              data: {
                emailDeliveryMethod:
                    "GL6",

                resendDomainId: null,
                resendDomainName: null,
                resendDomainStatus: null,
                resendFromEmail: null,
                resendFromName: null,
                resendDomainCreatedAt: null,
                resendDomainVerifiedAt: null,
                resendDomainLastError: null,
              },
            });

        return res.json({
          ok: true,
          settings:
              publicResendDomainSettings(
                  updated
              ),
        });
      } catch (error) {
        console.error(
            "Remove Resend domain failed:",
            error
        );

        return res.status(500).json({
          error:
              "Could not remove the sending domain.",
        });
      }
    }
);