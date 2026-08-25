import {
    shopifyPartnerGraphql,
    syncManagedPricingForShop,
} from "./shopify.js";

const DEFAULT_STALE_AFTER_MINUTES = 15;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_PARTNER_REQUEST_INTERVAL_MS = 300;

function positiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function pricingReconciliationSettings(env = process.env) {
    return {
        staleAfterMs: positiveNumber(
            env.SHOPIFY_PRICING_RECONCILE_STALE_AFTER_MINUTES,
            DEFAULT_STALE_AFTER_MINUTES
        ) * 60 * 1000,
        batchSize: Math.floor(positiveNumber(
            env.SHOPIFY_PRICING_RECONCILE_BATCH_SIZE,
            DEFAULT_BATCH_SIZE
        )),
        partnerRequestIntervalMs: Math.max(
            250,
            positiveNumber(
                env.SHOPIFY_PARTNER_REQUEST_INTERVAL_MS,
                DEFAULT_PARTNER_REQUEST_INTERVAL_MS
            )
        ),
    };
}

export function createRateLimitedPartnerQuery(
    partnerQuery = shopifyPartnerGraphql,
    {
        minimumIntervalMs = DEFAULT_PARTNER_REQUEST_INTERVAL_MS,
        sleep = (milliseconds) => new Promise(
            (resolve) => setTimeout(resolve, milliseconds)
        ),
        now = () => Date.now(),
    } = {}
) {
    let previousRequestStartedAt = null;

    return async (...args) => {
        if (previousRequestStartedAt !== null) {
            const waitMs = Math.max(
                0,
                minimumIntervalMs - (now() - previousRequestStartedAt)
            );
            if (waitMs > 0) await sleep(waitMs);
        }

        previousRequestStartedAt = now();
        return partnerQuery(...args);
    };
}

export async function reconcileStaleManagedPricingShops({
    prisma,
    now = new Date(),
    partnerQuery = shopifyPartnerGraphql,
    adminQuery,
    sleep,
    clock,
    settings = pricingReconciliationSettings(),
}) {
    const startedAt = now instanceof Date ? now : new Date(now);
    const staleBefore = new Date(startedAt.getTime() - settings.staleAfterMs);
    const shops = await prisma.shop.findMany({
        where: {
            uninstalledAt: null,
            OR: [
                { billingSyncedAt: null },
                { billingSyncedAt: { lte: staleBefore } },
            ],
        },
        orderBy: [
            { billingSyncedAt: "asc" },
            { shopDomain: "asc" },
        ],
        take: settings.batchSize,
    });
    const limitedPartnerQuery = createRateLimitedPartnerQuery(partnerQuery, {
        minimumIntervalMs: settings.partnerRequestIntervalMs,
        sleep,
        now: clock,
    });
    const result = {
        success: true,
        checked: shops.length,
        reconciled: 0,
        failed: 0,
        failures: [],
    };

    for (const shop of shops) {
        try {
            await syncManagedPricingForShop(prisma, shop, {
                partnerQuery: limitedPartnerQuery,
                adminQuery,
                now: startedAt,
            });
            result.reconciled += 1;
        } catch (error) {
            result.success = false;
            result.failed += 1;
            result.failures.push({
                shop: shop.shopDomain,
                error: error?.message || "Unknown pricing reconciliation error",
            });
        }
    }

    return result;
}
