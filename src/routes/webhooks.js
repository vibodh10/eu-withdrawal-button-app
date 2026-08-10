import express from 'express';
import { prisma } from '../lib/db.js';
import {
  mapPlanHandleToAppPlan,
  verifyWebhookHmac,
  getShopHandleFromDomain
} from '../lib/shopify.js';
import {
    recordDataAccess
} from "../lib/dataAccessAudit.js";

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
  const rawBody =
      req.rawBody ||
      (Buffer.isBuffer(req.body)
          ? req.body
          : Buffer.from(JSON.stringify(req.body || {})));

  if (!verifyWebhookHmac(rawBody, hmacHeader)) {
    res.status(401).send('invalid webhook signature');
    return false;
  }

  return true;
}

function logWebhookError(route, err) {
  console.error(`[Webhook error] ${route}:`, err);
}

webhookRouter.post('/app/uninstalled', async (req, res) => {
  try {
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
  } catch (err) {
    logWebhookError('/app/uninstalled', err);
    res.status(200).send('ok');
  }
});

webhookRouter.post('/app/subscriptions-update', async (req, res) => {
  try {
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
  } catch (err) {
    logWebhookError('/app/subscriptions-update', err);
    res.status(200).send('ok');
  }
});

webhookRouter.post('/gdpr', async (req, res) => {
  try {
    if (!requireValidWebhook(req, res)) return;
    res.status(200).send('ok');
  } catch (err) {
    logWebhookError('/gdpr', err);
    res.status(200).send('ok');
  }
});

// CUSTOMER DATA DELETE
webhookRouter.post(
    "/customers/redact",
    async (req, res) => {
        try {
            // Verify Shopify FIRST.
            if (!requireValidWebhook(req, res)) {
                return;
            }

            const shopDomain =
                req.headers["x-shopify-shop-domain"];

            if (!shopDomain) {
                return res.status(200).send("ok");
            }

            const shop =
                await prisma.shop.findUnique({
                    where: {
                        shopDomain,
                    },
                    select: {
                        id: true,
                    },
                });

            if (!shop) {
                return res.status(200).send("ok");
            }

            const body =
                parseWebhookBody(req);

            const customerEmail =
                String(
                    body?.customer?.email || ""
                )
                    .trim()
                    .toLowerCase();

            await prisma.$transaction(
                async (tx) => {
                    let deletedCount = 0;

                    if (customerEmail) {
                        const result =
                            await tx.withdrawalRequest
                                .deleteMany({
                                    where: {
                                        shopId: shop.id,
                                        customerEmail,
                                    },
                                });

                        deletedCount =
                            result.count;
                    }

                    await recordDataAccess({
                        db: tx,
                        shopId: shop.id,
                        action:
                            "CUSTOMER_DATA_REDACTED",
                        recordCount:
                        deletedCount,
                        actorType:
                            "SHOPIFY_WEBHOOK",
                        reason:
                            "Verified Shopify customers/redact webhook",
                    });
                }
            );

            return res
                .status(200)
                .send("ok");
        } catch (err) {
            logWebhookError(
                "/customers/redact",
                err
            );

            return res
                .status(200)
                .send("ok");
        }
    }
);

// SHOP DATA DELETE / GDPR FULL WIPE
webhookRouter.post(
    "/shop/redact",
    async (req, res) => {
        try {
            if (!requireValidWebhook(req, res)) {
                return;
            }

            const shopDomain =
                req.headers["x-shopify-shop-domain"];

            if (!shopDomain) {
                return res
                    .status(200)
                    .send("ok");
            }

            await prisma.$transaction(
                async (tx) => {
                    const shop =
                        await tx.shop.findUnique({
                            where: {
                                shopDomain,
                            },
                            select: {
                                id: true,
                            },
                        });

                    if (!shop) {
                        return;
                    }

                    const deleted =
                        await tx.withdrawalRequest
                            .deleteMany({
                                where: {
                                    shopId: shop.id,
                                },
                            });

                    await recordDataAccess({
                        db: tx,
                        shopId: shop.id,
                        action:
                            "SHOP_DATA_REDACTED",
                        recordId:
                        shop.id,
                        recordCount:
                        deleted.count,
                        actorType:
                            "SHOPIFY_WEBHOOK",
                        reason:
                            "Verified Shopify shop/redact webhook",
                    });

                    await tx.shop.delete({
                        where: {
                            id: shop.id,
                        },
                    });
                }
            );

            return res
                .status(200)
                .send("ok");
        } catch (err) {
            logWebhookError(
                "/shop/redact",
                err
            );

            return res
                .status(200)
                .send("ok");
        }
    }
);

// CUSTOMER DATA REQUEST
webhookRouter.post(
    "/customers/data_request",
    async (req, res) => {
        try {
            // Verify Shopify FIRST.
            if (!requireValidWebhook(req, res)) {
                return;
            }

            const shopDomain =
                req.headers["x-shopify-shop-domain"];

            if (!shopDomain) {
                return res
                    .status(200)
                    .json({ data: [] });
            }

            const shop =
                await prisma.shop.findUnique({
                    where: {
                        shopDomain,
                    },
                    select: {
                        id: true,
                    },
                });

            if (!shop) {
                return res
                    .status(200)
                    .json({ data: [] });
            }

            const body =
                parseWebhookBody(req);

            const customerEmail =
                String(
                    body?.customer?.email || ""
                )
                    .trim()
                    .toLowerCase();

            const data =
                await prisma.$transaction(
                    async (tx) => {
                        let rows = [];

                        if (customerEmail) {
                            rows =
                                await tx.withdrawalRequest
                                    .findMany({
                                        where: {
                                            shopId: shop.id,
                                            customerEmail,
                                        },
                                    });
                        }

                        await recordDataAccess({
                            db: tx,
                            shopId: shop.id,
                            action:
                                "CUSTOMER_DATA_REQUESTED",
                            recordCount:
                            rows.length,
                            actorType:
                                "SHOPIFY_WEBHOOK",
                            reason:
                                "Verified Shopify customers/data_request webhook",
                        });

                        return rows;
                    }
                );

            return res
                .status(200)
                .json({ data });
        } catch (err) {
            logWebhookError(
                "/customers/data_request",
                err
            );

            return res
                .status(200)
                .json({ data: [] });
        }
    }
);