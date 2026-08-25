import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";

import {
    ensureManagedInstallation,
    markShopUninstalled,
} from "../src/lib/managedInstallation.js";
import {
    exchangeIdTokenForOfflineToken,
    refreshAndSaveOfflineToken,
    ShopifyTokenExchangeError,
} from "../src/lib/offlineTokens.js";
import {
    getShopDomainFromSessionPayload,
    verifySessionToken,
} from "../src/lib/verifySessionToken.js";
import { createVerifyRequest } from "../src/middleware/verifyRequest.js";
import {
    ShopifyAuthStateChangedError,
    ShopifyTokenRefreshInProgressError,
} from "../src/lib/shopifyAuthState.js";

const SHOP_DOMAIN = "managed-install-test.myshopify.com";
const API_KEY = "managed-install-test-api-key";
const API_SECRET = "managed-install-test-secret";

process.env.SHOPIFY_API_KEY = API_KEY;
process.env.SHOPIFY_API_SECRET = API_SECRET;

function tokenPair(now, suffix = "new") {
    return {
        accessToken: `access-${suffix}`,
        accessTokenExpiresAt: new Date(now + 60 * 60 * 1000),
        refreshToken: `refresh-${suffix}`,
        refreshTokenExpiresAt: new Date(
            now + 90 * 24 * 60 * 60 * 1000
        ),
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function createMemoryPrisma(initialShop = null) {
    let shop = initialShop ? { ...initialShop } : null;

    function valuesMatch(actual, expected) {
        if (actual instanceof Date || expected instanceof Date) {
            return actual instanceof Date &&
                expected instanceof Date &&
                actual.getTime() === expected.getTime();
        }
        return actual === expected;
    }

    function matches(where) {
        if (!shop) return false;

        return Object.entries(where).every(([key, expected]) => {
            if (key === "OR") {
                return expected.some((condition) => matches(condition));
            }

            return valuesMatch(shop[key], expected);
        });
    }

    function applyData(data) {
        const next = { ...shop };

        for (const [key, value] of Object.entries(data)) {
            if (
                value &&
                typeof value === "object" &&
                !Array.isArray(value) &&
                !(value instanceof Date) &&
                Object.hasOwn(value, "increment")
            ) {
                next[key] = Number(next[key] || 0) + value.increment;
            } else {
                next[key] = value;
            }
        }

        shop = next;
        return { ...shop };
    }

    return {
        shop: {
            async findUnique({ where }) {
                return matches(where)
                    ? { ...shop }
                    : null;
            },
            async create({ data }) {
                if (shop?.shopDomain === data.shopDomain) {
                    const error = new Error("Unique constraint failed");
                    error.code = "P2002";
                    throw error;
                }
                shop = {
                    id: "shop-created",
                    brandingName: null,
                    ...data,
                };
                return { ...shop };
            },
            async upsert({ where, update, create }) {
                if (shop?.shopDomain === where.shopDomain) {
                    return applyData(update);
                } else {
                    shop = {
                        id: "shop-created",
                        brandingName: null,
                        ...create,
                    };
                }
                return { ...shop };
            },
            async update({ where, data }) {
                assert.equal(matches(where), true);
                return applyData(data);
            },
            async updateMany({ where, data }) {
                if (!matches(where)) {
                    return { count: 0 };
                }
                applyData(data);
                return { count: 1 };
            },
        },
        current() {
            return shop ? { ...shop } : null;
        },
    };
}

function installedShop(now, overrides = {}) {
    return {
        id: "shop-existing",
        shopDomain: SHOP_DOMAIN,
        ...tokenPair(now, "old"),
        tokenType: "EXPIRING_OFFLINE",
        tokenStatus: "ACTIVE",
        authVersion: 0,
        tokenRefreshError: null,
        tokenRefreshClaimId: null,
        tokenRefreshClaimedAt: null,
        uninstalledAt: null,
        plan: "PRO",
        brandingName: "Merchant-preserved branding",
        withdrawalDays: 21,
        ...overrides,
    };
}

async function createIdToken({
    expiresIn = 60,
    audience = API_KEY,
    issuerHost = SHOP_DOMAIN,
    destinationHost = SHOP_DOMAIN,
} = {}) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const secret = new TextEncoder().encode(API_SECRET);

    return new SignJWT({
        dest: `https://${destinationHost}`,
        aud: audience,
        sub: "staff-user",
    })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer(`https://${issuerHost}/admin`)
        .setIssuedAt(nowSeconds)
        .setNotBefore(nowSeconds - 1)
        .setExpirationTime(nowSeconds + expiresIn)
        .sign(secret);
}

test("first managed install exchanges the ID token and creates an active shop", async () => {
    const now = Date.now();
    const prisma = createMemoryPrisma();
    let exchangeInput;

    const shop = await ensureManagedInstallation({
        prisma,
        shopDomain: SHOP_DOMAIN,
        idToken: "first-install-id-token",
        now,
        exchangeToken: async (input) => {
            exchangeInput = input;
            return tokenPair(now);
        },
    });

    assert.deepEqual(exchangeInput, {
        shop: SHOP_DOMAIN,
        idToken: "first-install-id-token",
    });
    assert.equal(shop.accessToken, "access-new");
    assert.equal(shop.refreshToken, "refresh-new");
    assert.equal(shop.tokenType, "EXPIRING_OFFLINE");
    assert.equal(shop.tokenStatus, "ACTIVE");
    assert.equal(shop.uninstalledAt, null);
    assert.equal(shop.plan, "PAYMENT_REQUIRED");
});

test("verified uninstall clears the complete credential pair and marks reauth required", async () => {
    const now = Date.now();
    const prisma = createMemoryPrisma(installedShop(now));
    const uninstalledAt = new Date(now + 1000);

    await markShopUninstalled({
        prisma,
        shopDomain: SHOP_DOMAIN,
        uninstalledAt,
    });

    const shop = prisma.current();
    assert.equal(shop.uninstalledAt, uninstalledAt);
    assert.equal(shop.accessToken, null);
    assert.equal(shop.accessTokenExpiresAt, null);
    assert.equal(shop.refreshToken, null);
    assert.equal(shop.refreshTokenExpiresAt, null);
    assert.equal(shop.tokenStatus, "REAUTH_REQUIRED");
    assert.equal(shop.brandingName, "Merchant-preserved branding");
    assert.equal(shop.withdrawalDays, 21);
});

test("reinstall repairs a stale uninstalled row without replacing merchant data", async () => {
    const now = Date.now();
    const stale = installedShop(now, {
        accessToken: null,
        accessTokenExpiresAt: null,
        refreshToken: null,
        refreshTokenExpiresAt: null,
        tokenStatus: "REAUTH_REQUIRED",
        uninstalledAt: new Date(now - 60_000),
    });
    const prisma = createMemoryPrisma(stale);

    const shop = await ensureManagedInstallation({
        prisma,
        shopDomain: SHOP_DOMAIN,
        idToken: "reinstall-id-token",
        now,
        exchangeToken: async () => tokenPair(now, "reinstalled"),
    });

    assert.equal(shop.id, stale.id);
    assert.equal(shop.accessToken, "access-reinstalled");
    assert.equal(shop.refreshToken, "refresh-reinstalled");
    assert.equal(shop.uninstalledAt, null);
    assert.equal(shop.tokenStatus, "ACTIVE");
    assert.equal(shop.brandingName, stale.brandingName);
    assert.equal(shop.withdrawalDays, stale.withdrawalDays);
});

test("missing credentials are recovered from the current managed-install ID token", async () => {
    const now = Date.now();
    const prisma = createMemoryPrisma(installedShop(now, {
        accessToken: null,
        accessTokenExpiresAt: null,
        refreshToken: null,
        refreshTokenExpiresAt: null,
    }));
    let exchanges = 0;

    const shop = await ensureManagedInstallation({
        prisma,
        shopDomain: SHOP_DOMAIN,
        idToken: "recovery-id-token",
        now,
        exchangeToken: async () => {
            exchanges += 1;
            return tokenPair(now, "recovered");
        },
    });

    assert.equal(exchanges, 1);
    assert.equal(shop.accessToken, "access-recovered");
});

test("expired access credentials use the existing refresh-token flow", async () => {
    const now = Date.now();
    const prisma = createMemoryPrisma(installedShop(now, {
        accessTokenExpiresAt: new Date(now - 1000),
    }));
    let refreshes = 0;
    let exchanges = 0;

    const shop = await ensureManagedInstallation({
        prisma,
        shopDomain: SHOP_DOMAIN,
        idToken: "current-id-token",
        now,
        refreshToken: async (existing, options) => {
            refreshes += 1;
            return refreshAndSaveOfflineToken(existing, {
                ...options,
                now,
                refreshToken: async () =>
                    tokenPair(now, "refreshed"),
            });
        },
        exchangeToken: async () => {
            exchanges += 1;
            return tokenPair(now, "unexpected");
        },
    });

    assert.equal(refreshes, 1);
    assert.equal(exchanges, 0);
    assert.equal(shop.accessToken, "access-refreshed");
    assert.equal(shop.refreshToken, "refresh-refreshed");
    assert.equal(shop.authVersion, 1);
});

test("one durable owner rotates a one-time refresh token and a concurrent loser cannot overwrite it", async () => {
    const now = Date.now();
    const initial = installedShop(now, {
        accessTokenExpiresAt: new Date(now - 1000),
        authVersion: 12,
    });
    const prisma = createMemoryPrisma(initial);
    const refreshStarted = deferred();
    const refreshResult = deferred();
    let shopifyCalls = 0;
    let loserShopifyCalls = 0;

    const winner = refreshAndSaveOfflineToken(initial, {
        database: prisma,
        now,
        createClaimId: () => "refresh-owner",
        refreshToken: async ({ refreshToken }) => {
            shopifyCalls += 1;
            assert.equal(refreshToken, "refresh-old");
            refreshStarted.resolve();
            return refreshResult.promise;
        },
    });

    await refreshStarted.promise;

    await assert.rejects(
        refreshAndSaveOfflineToken(initial, {
            database: prisma,
            now,
            createClaimId: () => "stale-loser",
            refreshToken: async () => {
                loserShopifyCalls += 1;
                throw new Error("consumed refresh token");
            },
        }),
        ShopifyTokenRefreshInProgressError
    );

    assert.equal(prisma.current().authVersion, 13);
    assert.equal(prisma.current().tokenStatus, "REFRESHING");
    assert.equal(prisma.current().tokenRefreshClaimId, "refresh-owner");

    refreshResult.resolve(tokenPair(now, "rotated"));
    const rotated = await winner;

    assert.equal(shopifyCalls, 1);
    assert.equal(loserShopifyCalls, 0);
    assert.equal(rotated.authVersion, 13);
    assert.equal(rotated.accessToken, "access-rotated");
    assert.equal(rotated.refreshToken, "refresh-rotated");
    assert.equal(rotated.tokenStatus, "ACTIVE");
    assert.equal(rotated.tokenRefreshError, null);
    assert.equal(rotated.tokenRefreshClaimId, null);
    assert.equal(rotated.tokenRefreshClaimedAt, null);

    let recoveryExchanges = 0;
    const subsequent = await ensureManagedInstallation({
        prisma,
        shopDomain: SHOP_DOMAIN,
        idToken: "subsequent-id-token",
        now,
        exchangeToken: async () => {
            recoveryExchanges += 1;
            return tokenPair(now, "unexpected");
        },
    });

    assert.equal(recoveryExchanges, 0);
    assert.equal(subsequent.accessToken, "access-rotated");
    assert.equal(subsequent.refreshToken, "refresh-rotated");
});

test("refresh failure finalization does not advance the claimed generation", async () => {
    const now = Date.now();
    const initial = installedShop(now, {
        accessTokenExpiresAt: new Date(now - 1000),
        authVersion: 21,
    });
    const prisma = createMemoryPrisma(initial);

    await assert.rejects(
        refreshAndSaveOfflineToken(initial, {
            database: prisma,
            now,
            createClaimId: () => "failed-owner",
            refreshToken: async () => {
                throw new Error("definitive refresh failure");
            },
        }),
        /definitive refresh failure/
    );

    const failed = prisma.current();
    assert.equal(failed.authVersion, 22);
    assert.equal(failed.tokenStatus, "REAUTH_REQUIRED");
    assert.equal(failed.tokenRefreshError, "definitive refresh failure");
    assert.equal(failed.tokenRefreshClaimId, null);
});

test("managed installation recovers an ambiguous refresh failure with the current ID token", async () => {
    const now = Date.now();
    const initial = installedShop(now, {
        accessTokenExpiresAt: new Date(now - 1000),
        authVersion: 30,
    });
    const prisma = createMemoryPrisma(initial);
    let exchanges = 0;

    const recovered = await ensureManagedInstallation({
        prisma,
        shopDomain: SHOP_DOMAIN,
        idToken: "current-recovery-id-token",
        now,
        refreshToken: (existing, options) =>
            refreshAndSaveOfflineToken(existing, {
                ...options,
                now,
                createClaimId: () => "ambiguous-owner",
                refreshToken: async () => {
                    throw new Error("response lost after send");
                },
            }),
        exchangeToken: async () => {
            exchanges += 1;
            return tokenPair(now, "id-token-recovery");
        },
    });

    assert.equal(exchanges, 1);
    assert.equal(recovered.authVersion, 32);
    assert.equal(recovered.accessToken, "access-id-token-recovery");
    assert.equal(recovered.refreshToken, "refresh-id-token-recovery");
    assert.equal(recovered.tokenStatus, "ACTIVE");
    assert.equal(recovered.tokenRefreshClaimId, null);
    assert.equal(recovered.brandingName, initial.brandingName);
});

test("REAUTH_REQUIRED credentials never refresh and recover only through managed ID-token exchange", async () => {
    const now = Date.now();
    const reauthRequired = installedShop(now, {
        accessTokenExpiresAt: new Date(now - 1000),
        tokenStatus: "REAUTH_REQUIRED",
        tokenRefreshError: "response lost after send",
        authVersion: 35,
    });
    const prisma = createMemoryPrisma(reauthRequired);
    let claimIds = 0;
    let refreshes = 0;

    await assert.rejects(
        refreshAndSaveOfflineToken(reauthRequired, {
            database: prisma,
            now,
            createClaimId: () => {
                claimIds += 1;
                return "must-not-claim";
            },
            refreshToken: async () => {
                refreshes += 1;
                return tokenPair(now, "must-not-refresh");
            },
        }),
        /Re-auth required/
    );

    assert.equal(claimIds, 0);
    assert.equal(refreshes, 0);
    assert.deepEqual(prisma.current(), reauthRequired);

    const staleActiveSnapshot = {
        ...reauthRequired,
        tokenStatus: "ACTIVE",
    };
    let staleRefreshes = 0;

    await assert.rejects(
        refreshAndSaveOfflineToken(staleActiveSnapshot, {
            database: prisma,
            now,
            createClaimId: () => "stale-active-snapshot",
            refreshToken: async () => {
                staleRefreshes += 1;
                return tokenPair(now, "must-not-refresh-stale");
            },
        }),
        ShopifyAuthStateChangedError
    );

    assert.equal(staleRefreshes, 0);
    assert.deepEqual(prisma.current(), reauthRequired);

    let managedRefreshes = 0;
    let exchanges = 0;
    const recovered = await ensureManagedInstallation({
        prisma,
        shopDomain: SHOP_DOMAIN,
        idToken: "fresh-managed-install-id-token",
        now,
        refreshToken: async () => {
            managedRefreshes += 1;
            return tokenPair(now, "must-not-refresh");
        },
        exchangeToken: async () => {
            exchanges += 1;
            return tokenPair(now, "fresh-managed-exchange");
        },
    });

    assert.equal(managedRefreshes, 0);
    assert.equal(exchanges, 1);
    assert.equal(recovered.authVersion, 36);
    assert.equal(recovered.tokenStatus, "ACTIVE");
    assert.equal(recovered.accessToken, "access-fresh-managed-exchange");
    assert.equal(recovered.refreshToken, "refresh-fresh-managed-exchange");
});

test("expired refresh metadata does not advance the credential generation", async () => {
    const now = Date.now();
    const initial = installedShop(now, {
        refreshTokenExpiresAt: new Date(now - 1000),
        authVersion: 40,
    });
    const prisma = createMemoryPrisma(initial);

    await assert.rejects(
        refreshAndSaveOfflineToken(initial, {
            database: prisma,
            now,
        }),
        /Refresh token expired/
    );

    const failed = prisma.current();
    assert.equal(failed.authVersion, 40);
    assert.equal(failed.tokenStatus, "REAUTH_REQUIRED");
    assert.match(failed.tokenRefreshError, /Refresh token expired/);
});

test("failed reinstall exchange leaves uninstalled state and merchant data unchanged", async () => {
    const now = Date.now();
    const stale = installedShop(now, {
        accessToken: null,
        accessTokenExpiresAt: null,
        refreshToken: null,
        refreshTokenExpiresAt: null,
        tokenStatus: "REAUTH_REQUIRED",
        uninstalledAt: new Date(now - 1000),
    });
    const prisma = createMemoryPrisma(stale);

    await assert.rejects(
        ensureManagedInstallation({
            prisma,
            shopDomain: SHOP_DOMAIN,
            idToken: "bad-id-token",
            now,
            exchangeToken: async () => {
                throw new ShopifyTokenExchangeError("exchange rejected", {
                    status: 400,
                    retryInvalidSession: true,
                });
            },
        }),
        /exchange rejected/
    );

    assert.deepEqual(prisma.current(), stale);
});

test("uninstall during ID-token exchange wins over stale credential persistence", async () => {
    const now = Date.now();
    const prisma = createMemoryPrisma(installedShop(now, {
        accessToken: null,
        accessTokenExpiresAt: null,
        refreshToken: null,
        refreshTokenExpiresAt: null,
        authVersion: 4,
    }));
    const exchangeStarted = deferred();
    const exchangeResult = deferred();

    const installRequest = ensureManagedInstallation({
        prisma,
        shopDomain: SHOP_DOMAIN,
        idToken: "pre-uninstall-id-token",
        now,
        exchangeToken: async () => {
            exchangeStarted.resolve();
            return exchangeResult.promise;
        },
    });

    await exchangeStarted.promise;
    const uninstalledAt = new Date(now + 1000);
    await markShopUninstalled({
        prisma,
        shopDomain: SHOP_DOMAIN,
        uninstalledAt,
    });
    exchangeResult.resolve(tokenPair(now, "stale-exchange"));

    await assert.rejects(
        installRequest,
        ShopifyAuthStateChangedError
    );

    const shop = prisma.current();
    assert.equal(shop.authVersion, 5);
    assert.equal(shop.uninstalledAt, uninstalledAt);
    assert.equal(shop.accessToken, null);
    assert.equal(shop.refreshToken, null);
    assert.equal(shop.brandingName, "Merchant-preserved branding");
});

test("uninstall during refresh wins and the stale request does not exchange", async () => {
    const now = Date.now();
    const prisma = createMemoryPrisma(installedShop(now, {
        accessTokenExpiresAt: new Date(now - 1000),
        authVersion: 7,
    }));
    const refreshStarted = deferred();
    const refreshResult = deferred();
    let exchanges = 0;

    const installRequest = ensureManagedInstallation({
        prisma,
        shopDomain: SHOP_DOMAIN,
        idToken: "pre-uninstall-id-token",
        now,
        refreshToken: (existing, options) =>
            refreshAndSaveOfflineToken(existing, {
                ...options,
                now,
                refreshToken: async () => {
                    refreshStarted.resolve();
                    return refreshResult.promise;
                },
            }),
        exchangeToken: async () => {
            exchanges += 1;
            return tokenPair(now, "unexpected-exchange");
        },
    });

    await refreshStarted.promise;
    const uninstalledAt = new Date(now + 2000);
    await markShopUninstalled({
        prisma,
        shopDomain: SHOP_DOMAIN,
        uninstalledAt,
    });
    refreshResult.resolve(tokenPair(now, "stale-refresh"));

    await assert.rejects(
        installRequest,
        ShopifyAuthStateChangedError
    );

    const shop = prisma.current();
    assert.equal(exchanges, 0);
    assert.equal(shop.authVersion, 9);
    assert.equal(shop.uninstalledAt, uninstalledAt);
    assert.equal(shop.accessToken, null);
    assert.equal(shop.refreshToken, null);
});

test("a fresh managed-install request can reinstall after uninstall completed", async () => {
    const now = Date.now();
    const prisma = createMemoryPrisma(installedShop(now, {
        authVersion: 10,
    }));
    const uninstalledAt = new Date(now + 1000);

    await markShopUninstalled({
        prisma,
        shopDomain: SHOP_DOMAIN,
        uninstalledAt,
    });
    assert.equal(prisma.current().authVersion, 11);

    const reinstalled = await ensureManagedInstallation({
        prisma,
        shopDomain: SHOP_DOMAIN,
        idToken: "fresh-post-uninstall-id-token",
        now: now + 2000,
        exchangeToken: async () =>
            tokenPair(now + 2000, "fresh-reinstall"),
    });

    assert.equal(reinstalled.authVersion, 12);
    assert.equal(reinstalled.uninstalledAt, null);
    assert.equal(reinstalled.accessToken, "access-fresh-reinstall");
    assert.equal(reinstalled.tokenStatus, "ACTIVE");
    assert.equal(
        reinstalled.brandingName,
        "Merchant-preserved branding"
    );
});

test("an uninstall tombstone prevents a stale first-install request from creating a shop", async () => {
    const now = Date.now();
    const prisma = createMemoryPrisma();
    const exchangeStarted = deferred();
    const exchangeResult = deferred();

    const installRequest = ensureManagedInstallation({
        prisma,
        shopDomain: SHOP_DOMAIN,
        idToken: "stale-first-install-token",
        now,
        exchangeToken: async () => {
            exchangeStarted.resolve();
            return exchangeResult.promise;
        },
    });

    await exchangeStarted.promise;
    const uninstalledAt = new Date(now + 1000);
    await markShopUninstalled({
        prisma,
        shopDomain: SHOP_DOMAIN,
        uninstalledAt,
    });
    exchangeResult.resolve(tokenPair(now, "stale-first-install"));

    await assert.rejects(
        installRequest,
        ShopifyAuthStateChangedError
    );

    const shop = prisma.current();
    assert.equal(shop.authVersion, 1);
    assert.equal(shop.uninstalledAt, uninstalledAt);
    assert.equal(shop.accessToken, null);
    assert.equal(shop.refreshToken, null);
});

test("valid Shopify ID token validates audience and matching shop hosts", async () => {
    const token = await createIdToken();
    const payload = await verifySessionToken(token);

    assert.equal(
        getShopDomainFromSessionPayload(payload),
        SHOP_DOMAIN
    );
});

test("expired Shopify ID token is rejected", async () => {
    const token = await createIdToken({ expiresIn: -10 });

    await assert.rejects(
        verifySessionToken(token),
        /exp|expired/i
    );
});

test("ID-token exchange requests an expiring offline token pair", async () => {
    const now = Date.now();
    let request;

    const pair = await exchangeIdTokenForOfflineToken({
        shop: SHOP_DOMAIN,
        idToken: "fresh-id-token",
        now,
        fetchImpl: async (url, options) => {
            request = { url, options };
            return {
                ok: true,
                status: 200,
                async json() {
                    return {
                        access_token: "shopify-access",
                        expires_in: 3600,
                        refresh_token: "shopify-refresh",
                        refresh_token_expires_in: 7_776_000,
                    };
                },
            };
        },
    });

    const body = new URLSearchParams(request.options.body);
    assert.equal(
        request.url,
        `https://${SHOP_DOMAIN}/admin/oauth/access_token`
    );
    assert.equal(
        body.get("grant_type"),
        "urn:ietf:params:oauth:grant-type:token-exchange"
    );
    assert.equal(body.get("subject_token"), "fresh-id-token");
    assert.equal(
        body.get("subject_token_type"),
        "urn:ietf:params:oauth:token-type:id_token"
    );
    assert.equal(
        body.get("requested_token_type"),
        "urn:shopify:params:oauth:token-type:offline-access-token"
    );
    assert.equal(body.get("expiring"), "1");
    assert.equal(pair.accessToken, "shopify-access");
    assert.equal(pair.refreshToken, "shopify-refresh");
});

test("blocked shop is rejected before any credential exchange", async () => {
    let ensureCalls = 0;
    const middleware = createVerifyRequest({
        verifyToken: async () => ({
            iss: `https://${SHOP_DOMAIN}/admin`,
            dest: `https://${SHOP_DOMAIN}`,
        }),
        isBlocked: () => true,
        ensureInstallation: async () => {
            ensureCalls += 1;
        },
        database: {},
    });
    const response = createResponseRecorder();
    let nextCalled = false;

    await middleware(
        { headers: { authorization: "Bearer valid-id-token" } },
        response,
        () => {
            nextCalled = true;
        }
    );

    assert.equal(response.statusCode, 403);
    assert.equal(response.body, "Store access unavailable");
    assert.equal(ensureCalls, 0);
    assert.equal(nextCalled, false);
});

test("stale ID-token exchange asks App Bridge for one fresh retry", async () => {
    const middleware = createVerifyRequest({
        verifyToken: async () => ({
            iss: `https://${SHOP_DOMAIN}/admin`,
            dest: `https://${SHOP_DOMAIN}`,
        }),
        isBlocked: () => false,
        ensureInstallation: async () => {
            throw new ShopifyTokenExchangeError("stale token", {
                status: 400,
                retryInvalidSession: true,
            });
        },
        database: {},
    });
    const response = createResponseRecorder();

    await middleware(
        { headers: { authorization: "Bearer stale-id-token" } },
        response,
        () => assert.fail("next should not be called")
    );

    assert.equal(response.statusCode, 401);
    assert.equal(
        response.headers["X-Shopify-Retry-Invalid-Session-Request"],
        "1"
    );
});

function createResponseRecorder() {
    return {
        headers: {},
        statusCode: 200,
        body: null,
        set(name, value) {
            this.headers[name] = value;
            return this;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        send(body) {
            this.body = body;
            return this;
        },
    };
}
