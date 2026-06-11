import express from 'express';
import { prisma } from '../lib/db.js';
import { toCsv } from '../lib/csv.js';
import { isPro, PLANS } from '../lib/plans.js';
import verifyRequest from "../middleware/verifyRequest.js";
import { buildManagedPricingUrl } from '../lib/shopify.js';
import {exchangeOfflineToken, getValidOfflineToken} from "../lib/offlineTokens.js";

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

adminRouter.patch('/settings', async (req, res) => {
  const shop = req.shop;

  const patch = {
    brandingName: req.body.brandingName,
    locale: req.body.locale,
    merchantNotification: req.body.merchantNotification
  };

// 🔒 PRO ONLY
  if (isPro(shop)) {
    patch.brandingPrimaryColor = req.body.brandingPrimaryColor;
    patch.legalPageUrl = req.body.legalPageUrl;
    patch.privacyPageUrl = req.body.privacyPageUrl;
    patch.supportEmail = req.body.supportEmail;
    patch.withdrawalDays = parseInt(req.body.withdrawalDays, 10);
  }

  const cleaned = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));

  const updated = await prisma.shop.update({
    where: { id: shop.id },
    data: cleaned
  });

  res.json({ shop: updated });
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
adminRouter.patch('/email-templates/:code', async (req, res) => {
  const shop = req.shop;
  const { subject, bodyHtml } = req.body;

  const template = await prisma.emailTemplate.upsert({
    where: {
      shopId_code: {
        shopId: shop.id,
        code: req.params.code
      }
    },
    update: {
      subject,
      bodyHtml,
      isDefault: false
    },
    create: {
      shopId: shop.id,
      code: req.params.code,
      subject,
      bodyHtml,
      isDefault: false
    }
  });

  res.json({ template });
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

adminRouter.post("/migrate-expiring-token", async (req, res) => {
  const shop = req.shop;

  if (shop.tokenType === "EXPIRING_OFFLINE") {
    return res.json({
      success: true,
      message: "Shop already uses expiring offline tokens",
      tokenType: shop.tokenType,
    });
  }

  if (!shop.accessToken) {
    return res.status(400).json({
      error: "No existing offline access token found for this shop",
    });
  }

  try {
    const exchanged = await exchangeOfflineToken({
      shop: shop.shopDomain,
      oldAccessToken: shop.accessToken,
    });

    const updated = await prisma.shop.update({
      where: { id: shop.id },
      data: {
        accessToken: exchanged.accessToken,
        accessTokenExpiresAt: exchanged.accessTokenExpiresAt,
        refreshToken: exchanged.refreshToken,
        refreshTokenExpiresAt: exchanged.refreshTokenExpiresAt,
        tokenType: "EXPIRING_OFFLINE",
      },
    });

    res.json({
      success: true,
      shopDomain: updated.shopDomain,
      tokenType: updated.tokenType,
      accessTokenExpiresAt: updated.accessTokenExpiresAt,
      refreshTokenExpiresAt: updated.refreshTokenExpiresAt,
    });
  } catch (err) {
    console.error("Token migration failed:", err);

    res.status(500).json({
      error: "Token migration failed",
      message: err.message,
    });
  }
});

adminRouter.get("/test-shopify-token", async (req, res) => {
  try {
    const shop = req.shop;

    if (!shop) {
      return res.status(401).json({
        error: "No shop found on request",
      });
    }

    const accessToken = await getValidOfflineToken(shop);

    const response = await fetch(
        `https://${shop.shopDomain}/admin/api/2025-10/graphql.json`,
        {
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": accessToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: `
            query {
              shop {
                name
                myshopifyDomain
              }
            }
          `,
          }),
        }
    );

    const data = await response.json();

    if (!response.ok || data.errors) {
      return res.status(500).json({
        success: false,
        errors: data.errors || data,
      });
    }

    const updatedShop = await prisma.shop.findUnique({
      where: { id: shop.id },
      select: {
        tokenType: true,
        accessTokenExpiresAt: true,
        refreshTokenExpiresAt: true,
      },
    });

    res.json({
      success: true,
      tokenType: updatedShop.tokenType,
      accessTokenExpiresAt: updatedShop.accessTokenExpiresAt,
      refreshTokenExpiresAt: updatedShop.refreshTokenExpiresAt,
      shopifyShop: data.data.shop,
    });
  } catch (err) {
    console.error("Shopify token test failed:", err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});