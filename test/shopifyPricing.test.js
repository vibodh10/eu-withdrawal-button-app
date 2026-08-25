import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

process.env.APP_URL ||= "http://localhost:3000";
process.env.SHOPIFY_API_KEY ||= "pricing-test-key";
process.env.SHOPIFY_API_SECRET ||= "pricing-test-secret";
process.env.SHOPIFY_PARTNER_APP_ID ||= "gid://shopify/App/123";
process.env.SHOPIFY_MANAGED_PRICING_BASIC_HANDLE = "basic";
process.env.SHOPIFY_MANAGED_PRICING_PRO_HANDLE = "pro";
process.env.SHOPIFY_APP_PRICING_PAID_HANDLES = "pro,annual-pro";
process.env.SHOPIFY_PAID_ENTITLEMENT_MAX_AGE_MINUTES = "60";

const {
    PARTNER_ACTIVE_SUBSCRIPTION_QUERY,
    PARTNER_SUBSCRIPTION_HISTORY_QUERY,
    ShopifyPricingStateChangedError,
    classifyActivePricingContract,
    syncManagedPricingForShop,
    validatePricingConfiguration,
} = await import("../src/lib/shopify.js");
const {
    getEntitlementKind,
    hasAppEntitlement,
    hasPaidEntitlement,
} = await import("../src/lib/entitlements.js");
const {
    createRateLimitedPartnerQuery,
    reconcileStaleManagedPricingShops,
} = await import("../src/lib/pricingReconciliation.js");
const {
    ensureManagedInstallation,
    markShopUninstalled,
} = await import("../src/lib/managedInstallation.js");
const { deleteShopForGdpr } = await import("../src/routes/webhooks.js");

const SHOP_ID = "gid://shopify/Shop/456";
const SHOP_DOMAIN = "pricing-test.myshopify.com";
const APP_ID = process.env.SHOPIFY_PARTNER_APP_ID;
const API_KEY = process.env.SHOPIFY_API_KEY;

function clone(value) {
    return value == null ? value : structuredClone(value);
}

function matchesValue(actual, expected) {
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
        if (Object.hasOwn(expected, "lte")) {
            return actual == null || new Date(actual) <= new Date(expected.lte);
        }
    }
    if (actual instanceof Date || expected instanceof Date) {
        return new Date(actual).getTime() === new Date(expected).getTime();
    }
    return actual === expected;
}

function createPricingPrisma(initialShop) {
    let shop = clone(initialShop);

    function matches(where) {
        if (!shop) return false;
        return Object.entries(where).every(([key, expected]) => {
            if (key === "OR") return expected.some(matches);
            return matchesValue(shop[key], expected);
        });
    }

    function apply(data) {
        for (const [key, value] of Object.entries(data)) {
            if (value && typeof value === "object" &&
                !(value instanceof Date) && Object.hasOwn(value, "increment")) {
                shop[key] = Number(shop[key] || 0) + value.increment;
            } else {
                shop[key] = clone(value);
            }
        }
        return clone(shop);
    }

    const database = {
        shop: {
            async findMany() {
                return shop ? [clone(shop)] : [];
            },
            async findUnique({ where }) {
                return matches(where) ? clone(shop) : null;
            },
            async updateMany({ where, data }) {
                if (!matches(where)) return { count: 0 };
                apply(data);
                return { count: 1 };
            },
            async upsert({ where, update, create }) {
                if (shop?.shopDomain === where.shopDomain) return apply(update);
                shop = { id: "created", ...clone(create) };
                return clone(shop);
            },
            async create({ data }) {
                shop = { id: "created", ...clone(data) };
                return clone(shop);
            },
            async delete({ where }) {
                assert.equal(shop?.id, where.id);
                shop = null;
            },
        },
        withdrawalRequest: {
            async deleteMany() { return { count: 2 }; },
        },
        dataAccessAudit: {
            async create() { return {}; },
        },
        async $transaction(callback) { return callback(database); },
        current() { return clone(shop); },
    };
    return database;
}

function baseShop(overrides = {}) {
    const createdAt = new Date("2026-06-01T00:00:00.000Z");
    return {
        id: "shop-1",
        shopDomain: SHOP_DOMAIN,
        shopHandle: "pricing-test",
        shopifyShopId: SHOP_ID,
        accessToken: "access",
        accessTokenExpiresAt: new Date("2027-01-01T00:00:00.000Z"),
        refreshToken: "refresh",
        refreshTokenExpiresAt: new Date("2027-01-01T00:00:00.000Z"),
        tokenType: "EXPIRING_OFFLINE",
        tokenStatus: "ACTIVE",
        authVersion: 1,
        tokenRefreshClaimId: null,
        tokenRefreshClaimedAt: null,
        uninstalledAt: null,
        installedAt: createdAt,
        createdAt,
        billingSyncedAt: null,
        billingVersion: 0,
        grandfatheredFreeAt: createdAt,
        grandfatheredFreeRevokedAt: null,
        plan: "BASIC",
        currentPlanHandle: null,
        currentSubscriptionId: null,
        currentSubscriptionStatus: null,
        brandingName: "Preserved merchant settings",
        ...overrides,
    };
}

function billingIdentity(overrides = {}) {
    return {
        app: { id: APP_ID, apiKey: API_KEY },
        shop: { id: SHOP_ID, myshopifyDomain: SHOP_DOMAIN },
        ...overrides,
    };
}

function adminIdentity(overrides = {}) {
    return async () => billingIdentity(overrides);
}

function activeSubscription(
    handle,
    {
        present = handle !== null,
        app = billingIdentity().app,
        shop = billingIdentity().shop,
    } = {}
) {
    return {
        activeSubscription: !present ? null : {
            app,
            shop,
            legacySubscriptionId: "gid://shopify/AppSubscription/9",
            items: [{
                handle,
                price: {
                    __typename: "FlatRatePrice",
                    active: true,
                    currency: "USD",
                    amount: "10.00",
                },
            }],
        },
    };
}

function historyPage(nodes = []) {
    return {
        events: {
            edges: nodes.map((node, index) => ({
                cursor: `cursor-${index}`,
                node,
            })),
            pageInfo: { hasNextPage: false, endCursor: null },
        },
    };
}

function partnerState({
    activeHandle = null,
    activePresent = activeHandle !== null,
    activeApp = billingIdentity().app,
    activeShop = billingIdentity().shop,
    history = [],
} = {}) {
    return async (query) => {
        if (query === PARTNER_ACTIVE_SUBSCRIPTION_QUERY) {
            return activeSubscription(activeHandle, {
                present: activePresent,
                app: activeApp,
                shop: activeShop,
            });
        }
        assert.equal(query, PARTNER_SUBSCRIPTION_HISTORY_QUERY);
        return historyPage(history.map((event) => ({
            subject: event.subject || billingIdentity().app,
            shop: event.shop || billingIdentity().shop,
            ...event,
        })));
    };
}

test("existing grandfathered Free merchant remains entitled", async () => {
    const prisma = createPricingPrisma(baseShop());
    const result = await syncManagedPricingForShop(prisma, prisma.current(), {
        partnerQuery: partnerState(),
        adminQuery: adminIdentity(),
        partnerAppId: APP_ID,
        now: new Date("2026-08-25T12:00:00.000Z"),
    });

    assert.equal(result.shop.plan, "BASIC");
    assert.equal(result.shop.grandfatheredFreeRevokedAt, null);
    assert.equal(getEntitlementKind(result.shop), "GRANDFATHERED_FREE");
    assert.equal(hasAppEntitlement(result.shop), true);
});

test("new managed install is payment-required", async () => {
    const prisma = createPricingPrisma(null);
    const now = Date.parse("2026-08-25T12:00:00.000Z");
    const installed = await ensureManagedInstallation({
        prisma,
        shopDomain: SHOP_DOMAIN,
        idToken: "valid-managed-id-token",
        now,
        exchangeToken: async () => ({
            accessToken: "new-access",
            accessTokenExpiresAt: new Date(now + 3_600_000),
            refreshToken: "new-refresh",
            refreshTokenExpiresAt: new Date(now + 86_400_000),
        }),
    });

    assert.equal(installed.plan, "PAYMENT_REQUIRED");
    assert.equal(installed.grandfatheredFreeAt, undefined);
    assert.equal(hasAppEntitlement(installed), false);
});

test("grandfathered Free to paid permanently revokes Free and cancellation cannot restore it", async () => {
    const prisma = createPricingPrisma(baseShop());
    const paid = await syncManagedPricingForShop(prisma, prisma.current(), {
        partnerQuery: partnerState({ activeHandle: "pro" }),
        adminQuery: adminIdentity(),
        partnerAppId: APP_ID,
        now: new Date("2026-08-25T12:00:00.000Z"),
    });

    assert.equal(paid.shop.plan, "PRO");
    assert.ok(paid.shop.grandfatheredFreeRevokedAt);
    assert.equal(getEntitlementKind(paid.shop, {
        now: new Date("2026-08-25T12:00:00.000Z"),
    }), "PAID");

    const canceled = await syncManagedPricingForShop(prisma, prisma.current(), {
        partnerQuery: partnerState({
            history: [{
                eventType: "SUBSCRIPTION_CREATED",
                plan: { handle: "pro" },
            }],
        }),
        adminQuery: adminIdentity(),
        partnerAppId: APP_ID,
        now: new Date("2026-08-25T13:00:00.000Z"),
        redirectPlanHandle: "basic",
    });

    assert.equal(canceled.shop.plan, "PAYMENT_REQUIRED");
    assert.ok(canceled.shop.grandfatheredFreeRevokedAt);
    assert.equal(getEntitlementKind(canceled.shop), "PAYMENT_REQUIRED");
    assert.equal(hasAppEntitlement(canceled.shop), false);
});

test("a missed historical paid activation revokes grandfathering without an active subscription", async () => {
    const prisma = createPricingPrisma(baseShop());
    const result = await syncManagedPricingForShop(prisma, prisma.current(), {
        partnerQuery: partnerState({
            history: [{
                eventType: "SUBSCRIPTION_UPDATED",
                plan: { handle: "annual-pro" },
            }],
        }),
        adminQuery: adminIdentity(),
        partnerAppId: APP_ID,
        now: new Date("2026-08-25T12:00:00.000Z"),
    });

    assert.equal(result.shop.plan, "PAYMENT_REQUIRED");
    assert.ok(result.shop.grandfatheredFreeRevokedAt);
    assert.equal(hasAppEntitlement(result.shop), false);
});

test("grandfathered uninstall/reinstall retains Free while revoked reinstall remains revoked", async () => {
    const now = Date.parse("2026-08-25T12:00:00.000Z");
    for (const revoked of [false, true]) {
        const original = baseShop({
            grandfatheredFreeRevokedAt: revoked
                ? new Date("2026-08-24T00:00:00.000Z")
                : null,
        });
        const prisma = createPricingPrisma(original);
        await markShopUninstalled({
            prisma,
            shopDomain: SHOP_DOMAIN,
            uninstalledAt: new Date(now),
        });
        const tombstone = prisma.current();
        assert.equal(tombstone.grandfatheredFreeAt.getTime(), original.grandfatheredFreeAt.getTime());
        assert.equal(Boolean(tombstone.grandfatheredFreeRevokedAt), revoked);

        const reinstalled = await ensureManagedInstallation({
            prisma,
            shopDomain: SHOP_DOMAIN,
            idToken: "fresh-id-token",
            now: now + 1_000,
            exchangeToken: async () => ({
                accessToken: "reinstalled-access",
                accessTokenExpiresAt: new Date(now + 3_601_000),
                refreshToken: "reinstalled-refresh",
                refreshTokenExpiresAt: new Date(now + 86_401_000),
            }),
        });

        assert.equal(getEntitlementKind(reinstalled), "PAYMENT_REQUIRED");
        assert.equal(reinstalled.brandingName, "Preserved merchant settings");

        const reconciled = await syncManagedPricingForShop(
            prisma,
            prisma.current(),
            {
                partnerQuery: partnerState(),
                adminQuery: adminIdentity(),
                partnerAppId: APP_ID,
                now: new Date(now + 2_000),
            }
        );
        assert.equal(
            getEntitlementKind(reconciled.shop),
            revoked ? "PAYMENT_REQUIRED" : "GRANDFATHERED_FREE"
        );
    }
});

test("missing, public Free, or unknown Partner plan never grants Free and Partner state wins over redirect", async () => {
    for (const activeHandle of [null, "basic", "unknown-plan"]) {
        const prisma = createPricingPrisma(baseShop({
            grandfatheredFreeAt: null,
            plan: "PAYMENT_REQUIRED",
        }));
        const result = await syncManagedPricingForShop(prisma, prisma.current(), {
            partnerQuery: partnerState({ activeHandle }),
            adminQuery: adminIdentity(),
            partnerAppId: APP_ID,
            now: new Date("2026-08-25T12:00:00.000Z"),
            redirectPlanHandle: "pro",
        });

        assert.equal(result.shop.plan, "PAYMENT_REQUIRED");
        assert.equal(result.shop.grandfatheredFreeAt, null);
        assert.equal(result.redirectPlanHandleAccepted, false);
        assert.equal(hasAppEntitlement(result.shop), false);
    }
});

test("unknown or missing active handles fail closed without revoking and verified legacy Free can resume", async () => {
    for (const activeHandle of ["unknown-plan", null]) {
        const prisma = createPricingPrisma(baseShop());
        const unknown = await syncManagedPricingForShop(
            prisma,
            prisma.current(),
            {
                partnerQuery: async (query) => {
                    if (query === PARTNER_ACTIVE_SUBSCRIPTION_QUERY) {
                        return activeSubscription(activeHandle, {
                            present: true,
                        });
                    }
                    throw new Error(
                        "history must not delay fail-closed unknown handling"
                    );
                },
                adminQuery: adminIdentity(),
                partnerAppId: APP_ID,
                now: new Date("2026-08-25T12:00:00.000Z"),
            }
        );

        assert.equal(unknown.activeContractKind, "UNKNOWN");
        assert.equal(unknown.shop.plan, "PAYMENT_REQUIRED");
        assert.equal(unknown.shop.grandfatheredFreeRevokedAt, null);
        assert.equal(hasAppEntitlement(unknown.shop), false);

        const recovered = await syncManagedPricingForShop(
            prisma,
            prisma.current(),
            {
                partnerQuery: partnerState({ activeHandle: "basic" }),
                adminQuery: adminIdentity(),
                partnerAppId: APP_ID,
                now: new Date("2026-08-25T12:05:00.000Z"),
            }
        );

        assert.equal(recovered.activeContractKind, "LEGACY_FREE");
        assert.equal(recovered.shop.plan, "BASIC");
        assert.equal(recovered.shop.grandfatheredFreeRevokedAt, null);
        assert.equal(hasAppEntitlement(recovered.shop), true);
    }
});

test("concurrent unknown-plan reconciliation retries its stale CAS and cannot lose PAYMENT_REQUIRED", async () => {
    const prisma = createPricingPrisma(baseShop());
    const staleSnapshot = prisma.current();
    let releaseUnknown;
    let signalUnknownStarted;
    const unknownReleased = new Promise((resolve) => {
        releaseUnknown = resolve;
    });
    const unknownStarted = new Promise((resolve) => {
        signalUnknownStarted = resolve;
    });
    let unknownActiveCalls = 0;
    const unknownPartnerQuery = async (query) => {
        assert.equal(query, PARTNER_ACTIVE_SUBSCRIPTION_QUERY);
        unknownActiveCalls += 1;
        if (unknownActiveCalls === 1) {
            signalUnknownStarted();
            await unknownReleased;
        }
        return activeSubscription("unknown-plan");
    };

    const unknownResultPromise = syncManagedPricingForShop(
        prisma,
        staleSnapshot,
        {
            partnerQuery: unknownPartnerQuery,
            adminQuery: adminIdentity(),
            partnerAppId: APP_ID,
            now: new Date("2026-08-25T12:00:00.000Z"),
        }
    );
    await unknownStarted;

    const concurrentResult = await syncManagedPricingForShop(
        prisma,
        staleSnapshot,
        {
            partnerQuery: partnerState({ activeHandle: "basic" }),
            adminQuery: adminIdentity(),
            partnerAppId: APP_ID,
            now: new Date("2026-08-25T12:00:01.000Z"),
        }
    );
    assert.equal(concurrentResult.shop.plan, "BASIC");
    assert.equal(concurrentResult.reconciliationAttempts, 1);

    releaseUnknown();
    const unknownResult = await unknownResultPromise;
    assert.equal(unknownResult.reconciliationAttempts, 2);
    assert.equal(unknownActiveCalls, 2);
    assert.equal(unknownResult.activeContractKind, "UNKNOWN");
    assert.equal(unknownResult.shop.plan, "PAYMENT_REQUIRED");
    assert.equal(unknownResult.shop.grandfatheredFreeRevokedAt, null);
    assert.equal(unknownResult.shop.billingVersion, 2);
    assert.equal(hasAppEntitlement(prisma.current()), false);
});

test("authVersion change rejects an in-flight paid result and reconciles the fresh install generation", async () => {
    const prisma = createPricingPrisma(baseShop());
    const staleSnapshot = prisma.current();
    let releasePaid;
    let signalPaidStarted;
    const paidReleased = new Promise((resolve) => {
        releasePaid = resolve;
    });
    const paidStarted = new Promise((resolve) => {
        signalPaidStarted = resolve;
    });
    let activeCalls = 0;
    const changingPartnerQuery = async (query) => {
        if (query === PARTNER_ACTIVE_SUBSCRIPTION_QUERY) {
            activeCalls += 1;
            if (activeCalls === 1) {
                signalPaidStarted();
                await paidReleased;
                return activeSubscription("pro");
            }
            return activeSubscription("basic");
        }
        assert.equal(query, PARTNER_SUBSCRIPTION_HISTORY_QUERY);
        return historyPage();
    };

    const resultPromise = syncManagedPricingForShop(prisma, staleSnapshot, {
        partnerQuery: changingPartnerQuery,
        adminQuery: adminIdentity(),
        partnerAppId: APP_ID,
        now: new Date("2026-08-25T12:00:00.000Z"),
    });
    await paidStarted;
    const authChange = await prisma.shop.updateMany({
        where: { id: staleSnapshot.id, authVersion: 1 },
        data: {
            accessToken: "new-install-generation-token",
            authVersion: { increment: 1 },
        },
    });
    assert.equal(authChange.count, 1);
    releasePaid();

    const result = await resultPromise;
    assert.equal(result.reconciliationAttempts, 2);
    assert.equal(activeCalls, 2);
    assert.equal(result.shop.authVersion, 2);
    assert.equal(result.shop.billingVersion, 1);
    assert.equal(result.shop.plan, "BASIC");
    assert.equal(result.shop.currentPlanHandle, "basic");
    assert.equal(result.shop.grandfatheredFreeRevokedAt, null);
});

test("stale cron cannot persist after uninstall and a fresh reconciliation succeeds after reinstall", async () => {
    const prisma = createPricingPrisma(baseShop());
    let releasePartner;
    let signalPartnerStarted;
    const partnerReleased = new Promise((resolve) => {
        releasePartner = resolve;
    });
    const partnerStarted = new Promise((resolve) => {
        signalPartnerStarted = resolve;
    });
    const inFlightPartnerQuery = async (query) => {
        assert.equal(query, PARTNER_ACTIVE_SUBSCRIPTION_QUERY);
        signalPartnerStarted();
        await partnerReleased;
        return activeSubscription("pro");
    };

    const cronPromise = reconcileStaleManagedPricingShops({
        prisma,
        now: new Date("2026-08-25T12:00:00.000Z"),
        adminQuery: adminIdentity(),
        partnerQuery: inFlightPartnerQuery,
        settings: {
            staleAfterMs: 15 * 60 * 1000,
            batchSize: 100,
            partnerRequestIntervalMs: 300,
        },
    });
    await partnerStarted;
    await markShopUninstalled({
        prisma,
        shopDomain: SHOP_DOMAIN,
        uninstalledAt: new Date("2026-08-25T12:00:01.000Z"),
    });
    releasePartner();

    const cronResult = await cronPromise;
    assert.equal(cronResult.success, false);
    assert.equal(cronResult.reconciled, 0);
    assert.equal(cronResult.failed, 1);
    assert.match(cronResult.failures[0].error, /uninstalled during/);
    const tombstone = prisma.current();
    assert.equal(tombstone.plan, "PAYMENT_REQUIRED");
    assert.equal(tombstone.billingSyncedAt, null);
    assert.equal(tombstone.billingVersion, 0);
    assert.equal(tombstone.grandfatheredFreeRevokedAt, null);

    const reinstallTime = Date.parse("2026-08-25T12:01:00.000Z");
    await ensureManagedInstallation({
        prisma,
        shopDomain: SHOP_DOMAIN,
        idToken: "fresh-reinstall-id-token",
        now: reinstallTime,
        exchangeToken: async () => ({
            accessToken: "reinstalled-access",
            accessTokenExpiresAt: new Date(reinstallTime + 3_600_000),
            refreshToken: "reinstalled-refresh",
            refreshTokenExpiresAt: new Date(reinstallTime + 86_400_000),
        }),
    });
    const freshResult = await syncManagedPricingForShop(
        prisma,
        prisma.current(),
        {
            partnerQuery: partnerState({ activeHandle: "basic" }),
            adminQuery: adminIdentity(),
            partnerAppId: APP_ID,
            now: new Date("2026-08-25T12:02:00.000Z"),
        }
    );
    assert.equal(freshResult.reconciliationAttempts, 1);
    assert.equal(freshResult.shop.plan, "BASIC");
    assert.equal(freshResult.shop.billingVersion, 1);
    assert.equal(freshResult.shop.grandfatheredFreeRevokedAt, null);
    assert.equal(hasAppEntitlement(freshResult.shop), true);
});

test("an exhausted billing CAS conflict is an explicit failure and is never reported as success", async () => {
    const prisma = createPricingPrisma(baseShop());
    const before = prisma.current();
    const updateMany = prisma.shop.updateMany.bind(prisma.shop);
    let rejectedBillingWrites = 0;
    prisma.shop.updateMany = async ({ where, data }) => {
        if (Object.hasOwn(data, "billingVersion")) {
            rejectedBillingWrites += 1;
            return { count: 0 };
        }
        return updateMany({ where, data });
    };

    await assert.rejects(
        syncManagedPricingForShop(prisma, before, {
            partnerQuery: partnerState({ activeHandle: "unknown-plan" }),
            adminQuery: adminIdentity(),
            partnerAppId: APP_ID,
            now: new Date("2026-08-25T12:00:00.000Z"),
            maxAttempts: 2,
        }),
        (error) => {
            assert.ok(error instanceof ShopifyPricingStateChangedError);
            assert.equal(error.code, "SHOPIFY_PRICING_STATE_CHANGED");
            return true;
        }
    );
    assert.equal(rejectedBillingWrites, 2);
    assert.deepEqual(prisma.current(), before);
});

test("pricing configuration requires an explicit complete paid-handle set distinct from legacy Free", () => {
    const valid = validatePricingConfiguration({
        SHOPIFY_MANAGED_PRICING_BASIC_HANDLE: "basic",
        SHOPIFY_MANAGED_PRICING_PRO_HANDLE: "pro",
        SHOPIFY_APP_PRICING_PAID_HANDLES: "pro,annual-pro",
    });
    assert.deepEqual([...valid.paidHandles].sort(), ["annual-pro", "pro"]);
    assert.equal(classifyActivePricingContract(
        activeSubscription("basic").activeSubscription
    ), "LEGACY_FREE");

    assert.throws(
        () => validatePricingConfiguration({
            SHOPIFY_MANAGED_PRICING_BASIC_HANDLE: "basic",
            SHOPIFY_MANAGED_PRICING_PRO_HANDLE: "pro",
            SHOPIFY_APP_PRICING_PAID_HANDLES: "annual-pro",
        }),
        /must include SHOPIFY_MANAGED_PRICING_PRO_HANDLE/
    );
    assert.throws(
        () => validatePricingConfiguration({
            SHOPIFY_MANAGED_PRICING_BASIC_HANDLE: "basic",
            SHOPIFY_MANAGED_PRICING_PRO_HANDLE: "pro",
            SHOPIFY_APP_PRICING_PAID_HANDLES: "basic,pro",
        }),
        /legacy Free handle cannot also be configured as a paid handle/
    );
    assert.throws(
        () => validatePricingConfiguration({
            SHOPIFY_MANAGED_PRICING_BASIC_HANDLE: "basic",
            SHOPIFY_MANAGED_PRICING_PRO_HANDLE: "pro",
            SHOPIFY_APP_PRICING_PAID_HANDLES: "pro,PRO",
        }),
        /must not contain duplicate handles/
    );
});

test("app and shop identity mismatches abort before permanent grandfather revocation", async () => {
    const mismatches = [
        {
            adminQuery: adminIdentity({
                app: { id: "gid://shopify/App/999", apiKey: API_KEY },
            }),
            partnerQuery: partnerState({ activeHandle: "pro" }),
        },
        {
            adminQuery: adminIdentity({
                app: { id: APP_ID, apiKey: "wrong-local-api-key" },
            }),
            partnerQuery: partnerState({ activeHandle: "pro" }),
        },
        {
            shopOverrides: {
                shopifyShopId: "gid://shopify/Shop/999",
            },
            adminQuery: adminIdentity(),
            partnerQuery: partnerState({ activeHandle: "pro" }),
        },
        {
            adminQuery: adminIdentity(),
            partnerQuery: partnerState({
                activeHandle: "pro",
                activeApp: { id: APP_ID, apiKey: "wrong-api-key" },
            }),
        },
        {
            adminQuery: adminIdentity(),
            partnerQuery: partnerState({
                activeHandle: "pro",
                activeShop: {
                    id: "gid://shopify/Shop/999",
                    myshopifyDomain: "other.myshopify.com",
                },
            }),
        },
        {
            adminQuery: adminIdentity(),
            partnerQuery: partnerState({
                history: [{
                    eventType: "SUBSCRIPTION_CREATED",
                    plan: { handle: "pro" },
                    subject: { id: "gid://shopify/App/999", apiKey: API_KEY },
                }],
            }),
        },
    ];

    for (const mismatch of mismatches) {
        const {
            shopOverrides = {},
            ...reconciliationOptions
        } = mismatch;
        const prisma = createPricingPrisma(baseShop(shopOverrides));
        await assert.rejects(
            syncManagedPricingForShop(prisma, prisma.current(), {
                ...reconciliationOptions,
                partnerAppId: APP_ID,
                now: new Date("2026-08-25T12:00:00.000Z"),
            }),
            /billing identity mismatch/
        );
        assert.equal(prisma.current().grandfatheredFreeRevokedAt, null);
        assert.equal(prisma.current().billingSyncedAt, null);
        assert.equal(prisma.current().plan, "BASIC");
    }
});

test("paid entitlement expires by freshness while grandfathered Free does not", () => {
    const syncedAt = new Date("2026-08-25T12:00:00.000Z");
    const paidShop = baseShop({
        plan: "PRO",
        currentSubscriptionStatus: "ACTIVE",
        billingSyncedAt: syncedAt,
        grandfatheredFreeRevokedAt: syncedAt,
    });

    assert.equal(hasPaidEntitlement(paidShop, {
        now: new Date("2026-08-25T12:59:59.000Z"),
        maxAgeMs: 60 * 60 * 1000,
    }), true);
    assert.equal(hasPaidEntitlement(paidShop, {
        now: new Date("2026-08-25T13:00:01.000Z"),
        maxAgeMs: 60 * 60 * 1000,
    }), false);
    assert.equal(hasAppEntitlement(paidShop, {
        now: new Date("2026-08-25T13:00:01.000Z"),
        maxAgeMs: 60 * 60 * 1000,
    }), false);

    const grandfatheredShop = baseShop({
        billingSyncedAt: new Date("2025-01-01T00:00:00.000Z"),
    });
    assert.equal(hasAppEntitlement(grandfatheredShop, {
        now: new Date("2026-08-25T13:00:01.000Z"),
        maxAgeMs: 60 * 60 * 1000,
    }), true);
});

test("scheduled reconciliation rate-limits Partner calls and transient failure changes no entitlement timestamps", async () => {
    const clock = { value: 0 };
    const delays = [];
    const limited = createRateLimitedPartnerQuery(
        partnerState(),
        {
            minimumIntervalMs: 300,
            now: () => clock.value,
            sleep: async (milliseconds) => {
                delays.push(milliseconds);
                clock.value += milliseconds;
            },
        }
    );
    await limited(PARTNER_ACTIVE_SUBSCRIPTION_QUERY, {});
    await limited(PARTNER_SUBSCRIPTION_HISTORY_QUERY, {});
    assert.deepEqual(delays, [300]);

    const successfulPrisma = createPricingPrisma(baseShop({
        billingSyncedAt: null,
    }));
    const scheduledClock = { value: 0 };
    const scheduledDelays = [];
    const successful = await reconcileStaleManagedPricingShops({
        prisma: successfulPrisma,
        now: new Date("2026-08-25T12:00:00.000Z"),
        adminQuery: adminIdentity(),
        partnerQuery: partnerState({ activeHandle: "basic" }),
        clock: () => scheduledClock.value,
        sleep: async (milliseconds) => {
            scheduledDelays.push(milliseconds);
            scheduledClock.value += milliseconds;
        },
        settings: {
            staleAfterMs: 15 * 60 * 1000,
            batchSize: 100,
            partnerRequestIntervalMs: 300,
        },
    });
    assert.equal(successful.success, true);
    assert.equal(successful.reconciled, 1);
    assert.deepEqual(scheduledDelays, [300]);
    assert.equal(
        successfulPrisma.current().billingSyncedAt.getTime(),
        Date.parse("2026-08-25T12:00:00.000Z")
    );
    assert.equal(hasAppEntitlement(successfulPrisma.current()), true);

    const failedPrisma = createPricingPrisma(baseShop({
        plan: "PRO",
        currentSubscriptionStatus: "ACTIVE",
        billingSyncedAt: new Date("2026-08-25T10:00:00.000Z"),
        grandfatheredFreeRevokedAt: new Date("2026-08-25T09:00:00.000Z"),
    }));
    const before = failedPrisma.current();
    const result = await reconcileStaleManagedPricingShops({
        prisma: failedPrisma,
        now: new Date("2026-08-25T12:00:00.000Z"),
        adminQuery: adminIdentity(),
        partnerQuery: async () => {
            throw new Error("temporary Partner outage");
        },
        settings: {
            staleAfterMs: 15 * 60 * 1000,
            batchSize: 100,
            partnerRequestIntervalMs: 300,
        },
    });

    assert.equal(result.success, false);
    assert.equal(result.failed, 1);
    assert.deepEqual(failedPrisma.current(), before);
    assert.equal(hasAppEntitlement(failedPrisma.current(), {
        now: new Date("2026-08-25T12:00:00.000Z"),
        maxAgeMs: 60 * 60 * 1000,
    }), false);

    const grandfatheredPrisma = createPricingPrisma(baseShop({
        billingSyncedAt: new Date("2026-08-25T10:00:00.000Z"),
    }));
    const grandfatheredBefore = grandfatheredPrisma.current();
    const grandfatheredFailure = await reconcileStaleManagedPricingShops({
        prisma: grandfatheredPrisma,
        now: new Date("2026-08-25T12:00:00.000Z"),
        adminQuery: adminIdentity(),
        partnerQuery: async () => {
            throw new Error("temporary Partner outage");
        },
        settings: {
            staleAfterMs: 15 * 60 * 1000,
            batchSize: 100,
            partnerRequestIntervalMs: 300,
        },
    });
    assert.equal(grandfatheredFailure.success, false);
    assert.deepEqual(grandfatheredPrisma.current(), grandfatheredBefore);
    assert.equal(hasAppEntitlement(grandfatheredPrisma.current()), true);
});

test("cutover migration excludes shops already uninstalled", async () => {
    const sql = await readFile(
        new URL(
            "../prisma/migrations/20260825120000_grandfather_free_pricing/migration.sql",
            import.meta.url
        ),
        "utf8"
    );

    assert.match(
        sql,
        /WHERE "plan" = 'BASIC'\s+AND "uninstalledAt" IS NULL;/
    );
});

test("verified GDPR shop deletion removes the entitlement record", async () => {
    const prisma = createPricingPrisma(baseShop());
    const deleted = await deleteShopForGdpr({
        database: prisma,
        shopDomain: SHOP_DOMAIN,
    });

    assert.equal(deleted, true);
    assert.equal(prisma.current(), null);
});
