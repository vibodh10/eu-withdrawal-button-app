import express from 'express';
import { prisma } from '../lib/db.js';
import { mapPlanHandleToAppPlan, verifyWebhookHmac, getShopHandleFromDomain } from '../lib/shopify.js';

export const webhookRouter = express.Router();

function parseWebhookBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8') || '{}');
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  if (req.rawBody) return JSON.parse(req.rawBody.toString('utf8') || '{}');
  return {};
}

function requireValidWebhook(req, res) {
  const hmacHeader = req.headers['x-shopify-hmac-sha256'];
  const rawBody = req.rawBody || (Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {})));

  if (!verifyWebhookHmac(rawBody, hmacHeader)) {
    res.status(401).send('invalid webhook signature');
    return false;
  }

  return true;
}

webhookRouter.post('/app/uninstalled', async (req, res) => {
  if (!requireValidWebhook(req, res)) return;

  const shopDomain = req.headers['x-shopify-shop-domain'];

  if (shopDomain) {
    await prisma.shop.updateMany({
      where: { shopDomain },
      data: {
        uninstalledAt: new Date(),
        accessToken: null,
        plan: 'BASIC',
        currentPlanHandle: null,
        currentSubscriptionId: null,
        currentSubscriptionStatus: null
      }
    });
  }

  res.status(200).send('ok');
});

webhookRouter.post('/app/subscriptions-update', async (req, res) => {
  if (!requireValidWebhook(req, res)) return;

  const shopDomain = req.headers['x-shopify-shop-domain'];
  const body = parseWebhookBody(req);
  const planHandle = body?.plan_handle || null;
  const status = body?.status || null;
  const adminGraphqlApiId = body?.admin_graphql_api_id || body?.id || null;

  if (shopDomain) {
    await prisma.shop.updateMany({
      where: { shopDomain },
      data: {
        plan: mapPlanHandleToAppPlan(planHandle),
        currentPlanHandle: planHandle,
        currentSubscriptionStatus: status,
        currentSubscriptionId: adminGraphqlApiId,
        billingSyncedAt: new Date(),
        shopHandle: getShopHandleFromDomain(shopDomain)
      }
    });
  }

  res.status(200).send('ok');
});

webhookRouter.post('/gdpr', async (req, res) => {
  if (!requireValidWebhook(req, res)) return;
  res.status(200).send('ok');
});

// CUSTOMER DATA DELETE
webhookRouter.post('/customers/redact', async (req, res) => {
  if (!requireValidWebhook(req, res)) return;

  const body = parseWebhookBody(req);
  const customerEmail = body?.customer?.email;

  if (customerEmail) {
    await prisma.request.deleteMany({
      where: { customerEmail }
    });
  }

  res.status(200).send('ok');
});


// SHOP DATA DELETE (GDPR full wipe)
webhookRouter.post('/shop/redact', async (req, res) => {
  if (!requireValidWebhook(req, res)) return;

  const shopDomain = req.headers['x-shopify-shop-domain'];

  if (shopDomain) {
    await prisma.request.deleteMany({
      where: { shop: shopDomain }
    });

    // optional: also clean shop table
    await prisma.shop.deleteMany({
      where: { shopDomain }
    });
  }

  res.status(200).send('ok');
});


// CUSTOMER DATA REQUEST (export)
webhookRouter.post('/customers/data_request', async (req, res) => {
  if (!requireValidWebhook(req, res)) return;

  const body = parseWebhookBody(req);
  const customerEmail = body?.customer?.email;

  let data = [];

  if (customerEmail) {
    data = await prisma.request.findMany({
      where: { customerEmail }
    });
  }

  // Shopify expects 200 — data can be returned or logged
  res.status(200).json({ data });
});
