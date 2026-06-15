import '@shopify/shopify-api/adapters/node';

import express from 'express';
import { nanoid } from 'nanoid';
import { prisma } from '../lib/db.js';
import { sendEmail, buildConfirmationEmail } from '../lib/email.js';
import {shopify} from "../lib/shopify.js";
import {getValidOfflineToken} from "../lib/offlineTokens.js";

export const publicRouter = express.Router();

publicRouter.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      ok: true,
      db: true
    });

  } catch (err) {
    res.status(500).json({
      ok: false,
      db: false
    });
  }
});

publicRouter.options('/withdrawal-request', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(200);
});

publicRouter.post('/withdrawal-request', async (req, res) => {
  try {
    console.log("🔥 BODY:", req.body);

    const {
      shopDomain,
      customerEmail,
      customerName,
      orderNumber,
      orderId,
      reason,
      locale,
      legalCopyVersion
    } = req.body;

    if (!shopDomain || !customerEmail) {
      return res.status(400).json({ error: 'shopDomain and customerEmail are required' });
    }

    console.log("Incoming shopDomain:", shopDomain);

    const shop = await prisma.shop.findUnique({
      where: { shopDomain }
    });

    console.log("DB shop:", shop);

    if (!shop) {
      return res.status(404).json({ error: 'Shop is not installed' });
    }

    if (shop.uninstalledAt) {
      return res.status(404).json({ error: "Shop is not installed" });
    }

    let order = null;
    let verificationStatus = "UNVERIFIED";

    if (shop.plan === "PRO" && orderNumber) {
      try {
        const accessToken = await getValidOfflineToken(shop);

        const client = new shopify.clients.Graphql({
          session: {
            shop: shop.shopDomain,
            accessToken,
          },
        });

        const cleanOrderNumber = String(orderNumber).replace("#", "").trim();

        const response = await client.request(
            `
      query ($query: String!) {
        orders(first: 1, query: $query) {
          edges {
            node {
              id
              name
              createdAt
            }
          }
        }
      }
      `,
            {
              variables: {
                query: `name:#${cleanOrderNumber}`,
              },
            }
        );

        const foundOrder = response?.data?.orders?.edges?.[0]?.node;

        if (foundOrder) {
          order = foundOrder;

          const orderDate = new Date(order.createdAt);
          const diffDays =
              (Date.now() - orderDate.getTime()) /
              (1000 * 60 * 60 * 24);

          const withdrawalDays = shop.withdrawalDays || 14;

          if (diffDays > withdrawalDays) {
            // Still accept and record the request.
            verificationStatus = "EXPIRED";
          } else {
            verificationStatus = "VERIFIED";
          }
        } else {
          verificationStatus = "NOT_FOUND";
        }
      } catch (err) {
        console.error("Shopify API error:", err);
        verificationStatus = "ERROR";
      }
    }

    const publicReference = `WD-${nanoid(10).toUpperCase()}`;

    const requestRecord = await prisma.withdrawalRequest.create({
      data: {
        shopId: shop.id,
        publicReference,
        customerEmail,
        customerName,
        orderNumber,
        orderId: order?.id || null,
        verificationStatus,
        reason,
        locale: locale || shop.locale || 'en',
        legalCopyVersion,
        metadataJson: JSON.stringify(req.body)
      }
    });

    const template = await prisma.emailTemplate.findUnique({
      where: {
        shopId_code: {
          shopId: shop.id,
          code: "CONFIRMATION"
        }
      }
    });

    let subject;
    let bodyContent;

    if (template) {
      subject = template.subject;

      bodyContent = template.bodyHtml
          .replace(/{{reference}}/g, publicReference)
          .replace(/{{shopName}}/g, shop.brandingName || shop.shopDomain)
          .replace(/{{customerEmail}}/g, customerEmail || "")
          .replace(/{{customerName}}/g, customerName || "");

    } else {
      const fallback = buildConfirmationEmail({
        shopName: shop.brandingName || shop.shopDomain,
        reference: publicReference,
        locale: requestRecord.locale
      });

      subject = fallback.subject;
      bodyContent = fallback.html;
    }

    const html = `
  <div style="font-family: Arial, sans-serif;">

    <div
      style="
        background: ${shop.brandingPrimaryColor || "#111827"};
        padding: 16px;
        border-radius: 8px;
      "
    >
      <h2 style="color: white; margin: 0;">
        ${shop.brandingName || shop.shopDomain}
      </h2>
    </div>

    <div style="padding-top: 20px;">
      ${bodyContent}
    </div>

  </div>
`;

    try {
      await sendEmail({
        to: customerEmail,
        subject,
        html
      });
    } catch (e) {
      console.warn("Email failed:", e.message);
    }

    if (shop.merchantNotification) {
      try {
        await sendEmail({
          to: shop.merchantNotification,
          subject: `New withdrawal request ${publicReference}`,
          html: `<p>A new withdrawal request has been submitted.</p><p>Reference: <strong>${publicReference}</strong></p>`
        });
      } catch (e) {
        console.warn("Email failed:", e.message);
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

publicRouter.get('/settings', async (req, res) => {
  try {
    const shopDomain = req.query.shop;

    if (!shopDomain) {
      return res.status(400).json({
        error: "Missing shop parameter",
        withdrawalDays: 14,
        legalPageUrl: null,
        privacyPageUrl: null,
        supportEmail: null,
        showPoweredBy: true,
        poweredByText: "Powered by GL6"
      });
    }

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