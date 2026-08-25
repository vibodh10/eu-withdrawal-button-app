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

  return proHandles.has(value) ? "PRO" : "PAYMENT_REQUIRED";
}

function normalizedPlanHandle(value) {
  return String(value || "").trim().toLowerCase();
}

export function validatePricingConfiguration(env = process.env) {
  const legacyFreeHandle = normalizedPlanHandle(
      env.SHOPIFY_MANAGED_PRICING_BASIC_HANDLE || "basic"
  );
  const configuredProHandle = normalizedPlanHandle(
      env.SHOPIFY_MANAGED_PRICING_PRO_HANDLE || "pro"
  );
  const configured = String(
      env.SHOPIFY_APP_PRICING_PAID_HANDLES || ""
  )
      .split(",")
      .map(normalizedPlanHandle)
      .filter(Boolean);

  const paidHandles = new Set(configured);
  if (!legacyFreeHandle || paidHandles.size === 0) {
    throw new Error(
        "Shopify App Pricing requires a legacy Free handle and an explicit paid-handle set"
    );
  }
  if (!paidHandles.has(configuredProHandle)) {
    throw new Error(
        "SHOPIFY_APP_PRICING_PAID_HANDLES must include SHOPIFY_MANAGED_PRICING_PRO_HANDLE"
    );
  }
  if (paidHandles.size !== configured.length) {
    throw new Error(
        "SHOPIFY_APP_PRICING_PAID_HANDLES must not contain duplicate handles"
    );
  }
  if (paidHandles.has(legacyFreeHandle)) {
    throw new Error(
        "The legacy Free handle cannot also be configured as a paid handle"
    );
  }

  return { legacyFreeHandle, paidHandles };
}

function configuredPaidPlanHandles() {
  return validatePricingConfiguration().paidHandles;
}

export function isPaidPlanHandle(planHandle) {
  const normalized = normalizedPlanHandle(planHandle);
  return Boolean(normalized) && configuredPaidPlanHandles().has(normalized);
}

export function classifyActivePricingContract(subscription) {
  if (!subscription) return "NONE";

  const handle = normalizedPlanHandle(activePlanHandle(subscription));
  if (!handle) return "UNKNOWN";

  const { legacyFreeHandle, paidHandles } = validatePricingConfiguration();
  if (handle === legacyFreeHandle) return "LEGACY_FREE";
  if (paidHandles.has(handle)) return "PAID";
  return "UNKNOWN";
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

export const SHOP_IDENTITY_QUERY = `
  query BillingIdentity {
    shop { id myshopifyDomain }
    app { id apiKey }
  }
`;

export const PARTNER_ACTIVE_SUBSCRIPTION_QUERY = `
  query ActiveSubscription($appId: ID!, $shopId: ID!) {
    activeSubscription(appId: $appId, shopId: $shopId) {
      app { id apiKey }
      shop { id myshopifyDomain }
      billingPeriod
      cancelAtEndOfCycle
      legacySubscriptionId
      items {
        handle
        description
        price {
          __typename
          active
          currency
          ... on FlatRatePrice { amount }
        }
      }
    }
  }
`;

export const PARTNER_SUBSCRIPTION_HISTORY_QUERY = `
  query SubscriptionHistory(
    $appId: ID!
    $shopId: ID!
    $occurredAtMin: DateTime!
    $occurredAtMax: DateTime!
    $after: String
  ) {
    events(
      filter: {
        subjectId: $appId
        shopId: $shopId
        occurredAtMin: $occurredAtMin
        occurredAtMax: $occurredAtMax
        eventTypes: [
          SUBSCRIPTION_CREATED
          SUBSCRIPTION_UPDATED
          CHARGE_RECURRING
        ]
      }
      first: 250
      after: $after
    ) {
      edges {
        cursor
        node {
          id
          occurredAt
          eventType
          shop { id myshopifyDomain }
          subject {
            ... on AppReference { id apiKey }
          }
          ... on SubscriptionStatus {
            state
            plan { handle }
          }
          ... on Charge { planHandle }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function partnerApiConfiguration() {
  const organizationId = process.env.SHOPIFY_PARTNER_ORGANIZATION_ID;
  const accessToken = process.env.SHOPIFY_PARTNER_ACCESS_TOKEN;
  const appId = process.env.SHOPIFY_PARTNER_APP_ID;
  const apiVersion = process.env.SHOPIFY_PARTNER_API_VERSION || "2026-07";

  if (!organizationId || !accessToken || !appId) {
    throw new Error(
        "Shopify Partner API configuration is incomplete"
    );
  }

  return { organizationId, accessToken, appId, apiVersion };
}

export async function shopifyPartnerGraphql(
    query,
    variables,
    { fetchImpl = fetch } = {}
) {
  const config = partnerApiConfiguration();
  const response = await fetchImpl(
      `https://partners.shopify.com/${encodeURIComponent(config.organizationId)}/api/${config.apiVersion}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": config.accessToken,
        },
        body: JSON.stringify({ query, variables }),
      }
  );

  if (!response.ok) {
    throw new Error(`Shopify Partner API request failed with ${response.status}`);
  }

  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join(", "));
  }
  return json.data;
}

function activePlanHandle(subscription) {
  const flatRateItem = subscription?.items?.find(
      (item) => item?.price?.__typename === "FlatRatePrice"
  );
  return flatRateItem?.handle || subscription?.items?.[0]?.handle || null;
}

function assertIdentityValue(actual, expected, label) {
  if (!actual || actual !== expected) {
    throw new Error(`Shopify billing identity mismatch: ${label}`);
  }
}

function validatedLocalBillingIdentity(shop, identity, appId) {
  const localShop = identity?.shop;
  const localApp = identity?.app;
  const expectedDomain = normalizeShopDomain(shop?.shopDomain);
  const returnedDomain = normalizeShopDomain(localShop?.myshopifyDomain);
  const expectedApiKey = String(process.env.SHOPIFY_API_KEY || "").trim();

  assertIdentityValue(localShop?.id, localShop?.id, "Admin Shop ID is missing");
  assertIdentityValue(returnedDomain, expectedDomain, "Admin shop domain");
  if (shop?.shopifyShopId) {
    assertIdentityValue(localShop.id, shop.shopifyShopId, "stored Shopify Shop GID");
  }
  assertIdentityValue(localApp?.id, appId, "Partner app GID");
  assertIdentityValue(localApp?.apiKey, expectedApiKey, "Shopify API key");

  return {
    appId: localApp.id,
    apiKey: localApp.apiKey,
    shopId: localShop.id,
    shopDomain: returnedDomain,
  };
}

function validatePartnerIdentity({ app, shop }, expected) {
  assertIdentityValue(app?.id, expected.appId, "Partner app GID");
  assertIdentityValue(app?.apiKey, expected.apiKey, "Partner app API key");
  assertIdentityValue(shop?.id, expected.shopId, "Partner Shop GID");
  assertIdentityValue(
      normalizeShopDomain(shop?.myshopifyDomain),
      expected.shopDomain,
      "Partner shop domain"
  );
}

export function historyContainsPaidActivation(events) {
  return events.some((event) => {
    const handle = event?.plan?.handle || event?.planHandle || null;
    return isPaidPlanHandle(handle);
  });
}

export async function fetchSubscriptionHistory({
  appId,
  shopId,
  occurredAtMin,
  occurredAtMax,
  partnerQuery = shopifyPartnerGraphql,
  expectedIdentity,
}) {
  const events = [];
  const maximumWindowMs = 365 * 24 * 60 * 60 * 1000;
  let windowStart = new Date(occurredAtMin);
  const finalEnd = new Date(occurredAtMax);

  while (windowStart <= finalEnd) {
    const windowEnd = new Date(Math.min(
        windowStart.getTime() + maximumWindowMs,
        finalEnd.getTime()
    ));
    let after = null;

    do {
      const data = await partnerQuery(
          PARTNER_SUBSCRIPTION_HISTORY_QUERY,
          {
            appId,
            shopId,
            occurredAtMin: windowStart.toISOString(),
            occurredAtMax: windowEnd.toISOString(),
            after,
          }
      );
      const connection = data?.events;
      if (!connection || !Array.isArray(connection.edges) || !connection.pageInfo) {
        throw new Error("Shopify Partner subscription history response is incomplete");
      }
      const nodes = connection.edges.map((edge) => edge.node);
      if (expectedIdentity) {
        for (const event of nodes) {
          validatePartnerIdentity({
            app: event?.subject,
            shop: event?.shop,
          }, expectedIdentity);
        }
      }
      events.push(...nodes);
      after = connection?.pageInfo?.hasNextPage
          ? connection.pageInfo.endCursor
          : null;
    } while (after);

    if (windowEnd >= finalEnd) break;
    windowStart = new Date(windowEnd.getTime() + 1);
  }

  return events;
}

function billingWriteWhere(shop) {
  return {
    id: shop.id,
    billingSyncedAt: shop.billingSyncedAt || null,
    billingVersion: Number(shop.billingVersion || 0),
    authVersion: Number(shop.authVersion || 0),
    uninstalledAt: null,
  };
}

export class ShopifyPricingStateChangedError extends Error {
  constructor(message = "Shopify pricing state changed during reconciliation") {
    super(message);
    this.name = "ShopifyPricingStateChangedError";
    this.code = "SHOPIFY_PRICING_STATE_CHANGED";
  }
}

export async function syncManagedPricingForShop(
    prisma,
    shop,
    {
      partnerQuery = shopifyPartnerGraphql,
      adminQuery = shopifyAdminGraphql,
      now = new Date(),
      partnerAppId = process.env.SHOPIFY_PARTNER_APP_ID,
      maxAttempts = 3,
    } = {}
) {
  const startedAt = now instanceof Date ? now : new Date(now);
  const appId = partnerAppId;
  if (!appId) {
    throw new Error("Shopify Partner app ID is missing");
  }
  validatePricingConfiguration();
  const attemptLimit = Math.max(1, Math.floor(Number(maxAttempts) || 1));
  let observedShop = shop;

  for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
    if (!observedShop || observedShop.uninstalledAt) {
      throw new ShopifyPricingStateChangedError(
          "Shop was uninstalled during Shopify pricing reconciliation"
      );
    }
    if (!observedShop.accessToken) {
      throw new Error("Cannot verify Shopify billing identity without an installed shop token");
    }

    const localIdentityData = await adminQuery(
        observedShop,
        SHOP_IDENTITY_QUERY
    );
    const expectedIdentity = validatedLocalBillingIdentity(
        observedShop,
        localIdentityData,
        appId
    );
    const shopifyShopId = expectedIdentity.shopId;
    const activeData = await partnerQuery(
        PARTNER_ACTIVE_SUBSCRIPTION_QUERY,
        { appId, shopId: shopifyShopId }
    );
    if (!activeData || !Object.hasOwn(activeData, "activeSubscription")) {
      throw new Error("Shopify Partner active subscription response is incomplete");
    }
    const subscription = activeData?.activeSubscription || null;
    if (subscription) {
      validatePartnerIdentity(subscription, expectedIdentity);
    }
    const planHandle = activePlanHandle(subscription);
    const activeContractKind = classifyActivePricingContract(subscription);
    const activePaid = activeContractKind === "PAID";
    const shouldCheckHistory = Boolean(
        observedShop.grandfatheredFreeAt &&
        !observedShop.grandfatheredFreeRevokedAt &&
        activeContractKind !== "UNKNOWN" &&
        !activePaid
    );
    const history = shouldCheckHistory
        ? await fetchSubscriptionHistory({
          appId,
          shopId: shopifyShopId,
          occurredAtMin: new Date(
              observedShop.createdAt ||
              observedShop.installedAt ||
              observedShop.grandfatheredFreeAt
          ),
          occurredAtMax: startedAt,
          partnerQuery,
          expectedIdentity,
        })
        : [];
    const paidEver = activePaid || historyContainsPaidActivation(history);
    const revocationState = paidEver && observedShop.grandfatheredFreeAt
        ? startedAt
        : observedShop.grandfatheredFreeRevokedAt;
    const grandfatheredFreeActive = Boolean(
        observedShop.grandfatheredFreeAt && !revocationState
    );
    const data = {
      plan: activePaid
          ? "PRO"
          : activeContractKind !== "UNKNOWN" && grandfatheredFreeActive
              ? "BASIC"
              : "PAYMENT_REQUIRED",
      currentPlanHandle: planHandle,
      currentSubscriptionId: subscription?.legacySubscriptionId || null,
      currentSubscriptionStatus: subscription ? "ACTIVE" : null,
      billingSyncedAt: startedAt,
      billingVersion: { increment: 1 },
      shopifyShopId,
      shopHandle: observedShop.shopHandle ||
          getShopHandleFromDomain(observedShop.shopDomain),
      ...(revocationState && !observedShop.grandfatheredFreeRevokedAt
        ? { grandfatheredFreeRevokedAt: revocationState }
        : {}),
    };
    const persisted = await prisma.shop.updateMany({
      where: billingWriteWhere(observedShop),
      data,
    });

    if (persisted.count === 1) {
      const updated = await prisma.shop.findUnique({
        where: { id: observedShop.id },
      });
      if (!updated) {
        throw new ShopifyPricingStateChangedError(
            "Shop disappeared during Shopify pricing reconciliation"
        );
      }
      return {
        shop: updated,
        subscription,
        source: "partner_api",
        redirectPlanHandleAccepted: false,
        historicalPaidActivation: paidEver,
        activeContractKind,
        reconciliationAttempts: attempt,
      };
    }

    const currentShop = await prisma.shop.findUnique({
      where: { id: observedShop.id },
    });
    if (!currentShop) {
      throw new ShopifyPricingStateChangedError(
          "Shop disappeared during Shopify pricing reconciliation"
      );
    }
    if (currentShop.uninstalledAt) {
      throw new ShopifyPricingStateChangedError(
          "Shop was uninstalled during Shopify pricing reconciliation"
      );
    }
    if (attempt === attemptLimit) {
      throw new ShopifyPricingStateChangedError();
    }
    observedShop = currentShop;
  }

  throw new ShopifyPricingStateChangedError();
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
