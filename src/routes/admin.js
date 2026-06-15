import express from 'express';
import { prisma } from '../lib/db.js';
import { toCsv } from '../lib/csv.js';
import { isPro, PLANS } from '../lib/plans.js';
import verifyRequest from "../middleware/verifyRequest.js";
import { buildManagedPricingUrl } from '../lib/shopify.js';
import {exchangeOfflineToken, getValidOfflineToken} from "../lib/offlineTokens.js";
import {buildConfirmationEmail} from "../lib/email.js";

export const adminRouter = express.Router();

// ✅ ONE AUTH LAYER
adminRouter.use(verifyRequest);

adminRouter.get('/me', async (req, res) => {
  const shop = req.shop;

  res.json({
    shop,
    plans: PLANS,
    isPro: isPro(shop),
    managedPricing: {
      enabled: true,
      pricingUrl: buildManagedPricingUrl(shop.shopDomain)
    }
  });
});

adminRouter.get('/requests', async (req, res) => {
  const shop = req.shop;

  const requests = await prisma.withdrawalRequest.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: 'desc' },
    take: Number(req.query.limit || 100)
  });

  res.json({ requests });
});

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

adminRouter.patch('/requests/:id', async (req, res) => {
  const shop = req.shop;

  const record = await prisma.withdrawalRequest.findFirst({
    where: { id: req.params.id, shopId: shop.id }
  });

  if (!record) {
    return res.status(404).json({ error: 'Request not found' });
  }

  const allowedStatuses = ['RECEIVED', 'CONFIRMED', 'REVIEWED', 'APPROVED', 'REJECTED'];

  if (!allowedStatuses.includes(req.body.status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const isFinal = ['APPROVED', 'REJECTED'].includes(req.body.status);

  const updated = await prisma.withdrawalRequest.update({
    where: { id: record.id },
    data: {
      status: req.body.status,
      resolvedAt: isFinal
          ? record.resolvedAt || new Date() // ✅ set once
          : null // ✅ clear if not final
    }
  });

  res.json({ request: updated });
});

adminRouter.get('/export.csv', async (req, res) => {
  const shop = req.shop;

  if (!isPro(shop)) {
    return res.status(403).json({ error: "Upgrade to Pro" });
  }

  const rows = await prisma.withdrawalRequest.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: 'desc' }
  });

  const csv = toCsv(rows);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
      'Content-Disposition',
      'attachment; filename="withdrawal-requests.csv"'
  );

  return res.status(200).send(csv);
});

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
      shop: {
        ...updated,
        enabledLanguages: parseEnabledLanguages(
            updated.enabledLanguages
        ),
      },
    });
  } catch (error) {
    console.error("Update settings failed:", error);

    return res.status(500).json({
      error: "Could not update settings",
    });
  }
});

adminRouter.delete("/delete-customer", async (req, res) => {
  const { email } = req.body;

  await prisma.withdrawalRequest.deleteMany({
    where: { customerEmail: email }
  });

  res.json({ success: true });
});

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
adminRouter.patch("/email-templates/:code", async (req, res) => {
  try {
    const shop = req.shop;
    const code = req.params.code;

    const existing = await prisma.emailTemplate.findUnique({
      where: {
        shopId_code: {
          shopId: shop.id,
          code,
        },
      },
    });

    const submittedSubject = req.body.subject;
    const submittedBodyHtml = req.body.bodyHtml;

    /*
     * Existing template:
     * update only the fields that were actually supplied.
     */
    if (existing) {
      const patch = {};

      if (submittedSubject !== undefined) {
        patch.subject = String(submittedSubject);
      }

      if (submittedBodyHtml !== undefined) {
        patch.bodyHtml = String(submittedBodyHtml);
      }

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({
          error: "Provide a subject or email body to update.",
        });
      }

      patch.isDefault = false;

      const template = await prisma.emailTemplate.update({
        where: {
          id: existing.id,
        },
        data: patch,
      });

      return res.json({ template });
    }

    /*
     * New template:
     * both required database fields need initial values.
     */
    const fallback = buildConfirmationEmail({
      reference: "{{reference}}",
      locale: shop.locale || "en",
    });

    const template = await prisma.emailTemplate.create({
      data: {
        shopId: shop.id,
        code,
        subject:
            submittedSubject !== undefined
                ? String(submittedSubject)
                : fallback.subject,
        bodyHtml:
            submittedBodyHtml !== undefined
                ? String(submittedBodyHtml)
                : fallback.html,
        isDefault: false,
      },
    });

    return res.json({ template });
  } catch (error) {
    console.error("Update email template failed:", error);

    return res.status(500).json({
      error: "Could not update email template.",
    });
  }
});

adminRouter.delete('/requests/:id', async (req, res) => {
    const shop = req.shop;

    const record = await prisma.withdrawalRequest.findFirst({
        where: {
            id: req.params.id,
            shopId: shop.id
        }
    });

    if (!record) {
        return res.status(404).json({
            error: 'Request not found'
        });
    }

    await prisma.withdrawalRequest.delete({
        where: {
            id: record.id
        }
    });

    res.json({
        success: true
    });
});

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