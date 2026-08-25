export const APP_PLAN = Object.freeze({
    GRANDFATHERED_FREE: "BASIC",
    PAID: "PRO",
    PAYMENT_REQUIRED: "PAYMENT_REQUIRED",
});

const DEFAULT_PAID_ENTITLEMENT_MAX_AGE_MINUTES = 60;

export function paidEntitlementMaxAgeMs(env = process.env) {
    const configured = Number(
        env.SHOPIFY_PAID_ENTITLEMENT_MAX_AGE_MINUTES ||
        DEFAULT_PAID_ENTITLEMENT_MAX_AGE_MINUTES
    );

    if (!Number.isFinite(configured) || configured <= 0) {
        return 0;
    }

    return configured * 60 * 1000;
}

export function hasPaidEntitlement(
    shop,
    {
        now = Date.now(),
        maxAgeMs = paidEntitlementMaxAgeMs(),
    } = {}
) {
    const syncedAt = shop?.billingSyncedAt
        ? new Date(shop.billingSyncedAt).getTime()
        : Number.NaN;
    const nowMs = now instanceof Date ? now.getTime() : Number(now);
    const billingStateIsFresh = Number.isFinite(syncedAt) &&
        Number.isFinite(nowMs) &&
        maxAgeMs > 0 &&
        nowMs - syncedAt <= maxAgeMs;

    return Boolean(
        shop &&
        shop.plan === APP_PLAN.PAID &&
        shop.currentSubscriptionStatus === "ACTIVE" &&
        billingStateIsFresh
    );
}

export function hasGrandfatheredFreeEntitlement(shop) {
    return Boolean(
        shop &&
        shop.plan === APP_PLAN.GRANDFATHERED_FREE &&
        shop.grandfatheredFreeAt &&
        !shop.grandfatheredFreeRevokedAt
    );
}

export function hasAppEntitlement(shop, options) {
    return hasPaidEntitlement(shop, options) ||
        hasGrandfatheredFreeEntitlement(shop);
}

export function getEntitlementKind(shop, options) {
    if (hasPaidEntitlement(shop, options)) return "PAID";
    if (hasGrandfatheredFreeEntitlement(shop)) {
        return "GRANDFATHERED_FREE";
    }
    return "PAYMENT_REQUIRED";
}

export function publicEntitlementView(shop, options) {
    const kind = getEntitlementKind(shop, options);
    return {
        kind,
        hasAccess: kind !== "PAYMENT_REQUIRED",
        isPaid: kind === "PAID",
        isGrandfatheredFree: kind === "GRANDFATHERED_FREE",
    };
}
