import '@shopify/shopify-api/adapters/node';

import crypto from 'crypto';
import {shopifyApi} from "@shopify/shopify-api";
import {SQLiteSessionStorage} from "@shopify/shopify-app-session-storage-sqlite";
import {getValidOfflineToken} from "./offlineTokens.js";

const DEFAULT_APP_URL = process.env.APP_URL || 'http://localhost:3000';
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || '';
const SHOPIFY_APP_HANDLE = process.env.SHOPIFY_APP_HANDLE || 'eu-withdrawal-button-2026';

function normalizeShopDomain(value) {
  if (!value) return null;
  try {
    const asUrl = value.startsWith('http') ? new URL(value) : null;
    return (asUrl ? asUrl.hostname : value).replace(/^https?:\/\//, '').trim().toLowerCase();
  } catch {
    return String(value).replace(/^https?:\/\//, '').trim().toLowerCase();
  }
}

export function getShopHandleFromDomain(shopDomain) {
  const normalized = normalizeShopDomain(shopDomain);
  if (!normalized) return null;
  return normalized.replace('.myshopify.com', '');
}

export function buildManagedPricingUrl(shopDomain) {
  const shopHandle = getShopHandleFromDomain(shopDomain);
  if (!shopHandle) {
    throw new Error('Cannot build managed pricing URL without a valid shop domain');
  }
  return `https://admin.shopify.com/store/${shopHandle}/charges/${SHOPIFY_APP_HANDLE}/pricing_plans`;
}

export function mapPlanHandleToAppPlan(planHandle) {
  const value = String(planHandle || "")
      .trim()
      .toLowerCase();

  const liveProHandle = String(
      process.env.SHOPIFY_MANAGED_PRICING_PRO_HANDLE || "pro"
  )
      .trim()
      .toLowerCase();

  const proHandles = new Set([
    liveProHandle,
    "pro-test",
  ]);

  return proHandles.has(value) ? "PRO" : "BASIC";
}

export function verifyWebhookHmac(rawBody, hmacHeader) {
  if (!SHOPIFY_API_SECRET || !rawBody || !hmacHeader) {
    return false;
  }

  const digest = crypto
      .createHmac('sha256', SHOPIFY_API_SECRET)
      .update(rawBody, 'utf8')
      .digest('base64');

  const received = Buffer.from(hmacHeader, 'utf8');
  const generated = Buffer.from(digest, 'utf8');

  if (received.length !== generated.length) return false;
  return crypto.timingSafeEqual(received, generated);
}

export async function shopifyAdminGraphql(shopOrDomain, accessTokenOrQuery, queryOrVariables = {}, maybeVariables = {}) {
  let shopDomain;
  let accessToken;
  let query;
  let variables;

  // New usage: shopifyAdminGraphql(shop, query, variables)
  if (typeof shopOrDomain === "object") {
    const shop = shopOrDomain;
    shopDomain = shop.shopDomain;
    accessToken = await getValidOfflineToken(shop);
    query = accessTokenOrQuery;
    variables = queryOrVariables || {};
  } else {
    // Old usage still supported: shopifyAdminGraphql(shopDomain, accessToken, query, variables)
    shopDomain = shopOrDomain;
    accessToken = accessTokenOrQuery;
    query = queryOrVariables;
    variables = maybeVariables;
  }

  const normalizedShop = normalizeShopDomain(shopDomain);

  if (!normalizedShop || !accessToken) {
    throw new Error("Shop domain and access token are required for Shopify Admin API requests");
  }

  const response = await fetch(`https://${normalizedShop}/admin/api/2026-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Shopify GraphQL request failed with ${response.status}`);
  }

  const json = await response.json();

  if (json.errors?.length) {
    throw new Error(json.errors.map((item) => item.message).join(", "));
  }

  return json.data;
}

export const ACTIVE_SUBSCRIPTIONS_QUERY = `
  query ActiveAppSubscriptions {
    appInstallation {
      activeSubscriptions {
        id
        name
        status
        lineItems {
          plan {
            pricingDetails {
              __typename
              ... on AppRecurringPricing {
                interval
                planHandle
                price {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    }
  }
`;

export async function syncManagedPricingForShop(prisma, shop) {
  if (!shop?.accessToken) {
    const updated = await prisma.shop.update({
      where: { id: shop.id },
      data: {
        plan: 'BASIC',
        currentPlanHandle: null,
        currentSubscriptionId: null,
        currentSubscriptionStatus: null,
        billingSyncedAt: new Date(),
        shopHandle: shop.shopHandle || getShopHandleFromDomain(shop.shopDomain)
      }
    });
    return { shop: updated, subscription: null, source: 'no_access_token' };
  }

  const data = await shopifyAdminGraphql(shop, ACTIVE_SUBSCRIPTIONS_QUERY);
  const activeSubscriptions = data?.appInstallation?.activeSubscriptions || [];

  const recurring = activeSubscriptions.find((subscription) => {
    const pricing = subscription?.lineItems?.[0]?.plan?.pricingDetails;
    return pricing?.__typename === 'AppRecurringPricing';
  }) || null;

  const planHandle = recurring?.lineItems?.[0]?.plan?.pricingDetails?.planHandle || null;
  const mappedPlan = mapPlanHandleToAppPlan(planHandle);

  const updated = await prisma.shop.update({
    where: { id: shop.id },
    data: {
      plan: recurring ? mappedPlan : 'BASIC',
      currentPlanHandle: planHandle,
      currentSubscriptionId: recurring?.id || null,
      currentSubscriptionStatus: recurring?.status || null,
      billingSyncedAt: new Date(),
      shopHandle: shop.shopHandle || getShopHandleFromDomain(shop.shopDomain)
    }
  });

  return {
    shop: updated,
    subscription: recurring,
    source: 'graphql'
  };
}

export function getPostPlanReturnUrl(shopDomain) {
  const encodedShop = encodeURIComponent(shopDomain);
  return `${DEFAULT_APP_URL}/?shop=${encodedShop}&billing_return=1`;
}

export const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: ['read_orders'], // match your toml
  hostName: process.env.APP_URL.replace(/https?:\/\//, ''),
  apiVersion: "2024-10",
  isEmbeddedApp: true,

  // 🔥 THIS IS CRITICAL
  sessionStorage: new SQLiteSessionStorage('./sessions.sqlite'),
});