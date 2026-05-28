import '@shopify/shopify-api/adapters/node';

import express from 'express';
import { nanoid } from 'nanoid';
import { prisma } from '../lib/db.js';
import { sendEmail, buildConfirmationEmail } from '../lib/email.js';
import {shopify} from "../lib/shopify.js";

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

    let order = null;
    let verificationStatus = "UNVERIFIED";

    if (shop.plan === "PRO" && shop.accessToken && orderNumber) {
      try {
        const client = new shopify.clients.Graphql({
          session: {
            shop: shopDomain,
            accessToken: shop.accessToken,
          },
        });

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
                query: `name:#${orderNumber}`,
              },
            }
        );

        const foundOrder = response?.data?.orders?.edges?.[0]?.node;

        if (foundOrder) {
          order = foundOrder;
          verificationStatus = "VERIFIED";

          // ✅ Only enforce withdrawal window if VERIFIED
          const orderDate = new Date(order.createdAt);
          const diffDays = (Date.now() - orderDate) / (1000 * 60 * 60 * 24);

          const withdrawalDays = shop.withdrawalDays || 14;

          if (diffDays > withdrawalDays) {
            return res.status(400).json({
              error: `Withdrawal period expired (${withdrawalDays} days)`
            });
          }

        } else {
          verificationStatus = "NOT_FOUND";
        }

      } catch (err) {
        console.error("Shopify API error:", err);

        // 🔑 DO NOT FAIL REQUEST
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
  const shopDomain = req.query.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain }
  });

  if (!shop) {
    return res.json({
      withdrawalDays: 14
    });
  }

  const isPro = shop.plan === "PRO";

  res.json({
    withdrawalDays: isPro ? shop.withdrawalDays || 14 : 14,
    legalPageUrl: isPro ? shop.legalPageUrl : null,
    privacyPageUrl: isPro ? shop.privacyPageUrl : null,
    supportEmail: isPro ? shop.supportEmail : null
  });
});