import { prisma } from "./db.js";
import { randomUUID } from "node:crypto";
import { normalizeShopDomain } from "./blockedShops.js";
import {
    getShopAuthVersion,
    ShopifyAuthStateChangedError,
    ShopifyTokenRefreshInProgressError,
} from "./shopifyAuthState.js";

function toExpiryDate(seconds, now = Date.now()) {
    if (!seconds) return null;
    return new Date(now + Number(seconds) * 1000);
}

export class ShopifyTokenExchangeError extends Error {
    constructor(message, { status = null, retryInvalidSession = false } = {}) {
        super(message);
        this.name = "ShopifyTokenExchangeError";
        this.status = status;
        this.retryInvalidSession = retryInvalidSession;
    }
}

async function readTokenResponse(res) {
    try {
        return await res.json();
    } catch {
        return {};
    }
}

function requireExpiringOfflineTokenPair(data, now = Date.now()) {
    const expiresIn = Number(data?.expires_in);
    const refreshTokenExpiresIn = Number(data?.refresh_token_expires_in);

    if (
        !data?.access_token ||
        !data?.refresh_token ||
        !Number.isFinite(expiresIn) ||
        expiresIn <= 0 ||
        !Number.isFinite(refreshTokenExpiresIn) ||
        refreshTokenExpiresIn <= 0
    ) {
        throw new ShopifyTokenExchangeError(
            "Shopify did not return a complete expiring offline token pair"
        );
    }

    return {
        accessToken: data.access_token,
        accessTokenExpiresAt: toExpiryDate(expiresIn, now),
        refreshToken: data.refresh_token,
        refreshTokenExpiresAt: toExpiryDate(refreshTokenExpiresIn, now),
    };
}

async function readCurrentShop(database, id) {
    const current = await database.shop.findUnique({
        where: { id },
    });

    if (!current) {
        throw new ShopifyAuthStateChangedError();
    }

    return current;
}

async function markRefreshFailureIfCurrent({
    database,
    shop,
    message,
}) {
    const result = await database.shop.updateMany({
        where: {
            id: shop.id,
            authVersion: getShopAuthVersion(shop),
            uninstalledAt: null,
            refreshToken: shop.refreshToken,
            tokenRefreshClaimId: null,
        },
        data: {
            tokenStatus: "REAUTH_REQUIRED",
            tokenRefreshError: message,
        },
    });

    if (result.count !== 1) {
        throw new ShopifyAuthStateChangedError();
    }

    return readCurrentShop(database, shop.id);
}

async function claimRefreshOwnership({
    database,
    shop,
    claimId,
    now,
}) {
    const result = await database.shop.updateMany({
        where: {
            id: shop.id,
            authVersion: getShopAuthVersion(shop),
            uninstalledAt: null,
            refreshToken: shop.refreshToken,
            tokenRefreshClaimId: null,
            OR: [
                { tokenStatus: null },
                { tokenStatus: "ACTIVE" },
            ],
        },
        data: {
            tokenStatus: "REFRESHING",
            tokenRefreshClaimId: claimId,
            tokenRefreshClaimedAt: new Date(now),
            tokenRefreshError: null,
            authVersion: {
                increment: 1,
            },
        },
    });

    if (result.count !== 1) {
        const current = await readCurrentShop(database, shop.id);

        if (
            !current.uninstalledAt &&
            current.tokenStatus === "REFRESHING" &&
            current.tokenRefreshClaimId
        ) {
            throw new ShopifyTokenRefreshInProgressError();
        }

        throw new ShopifyAuthStateChangedError();
    }

    const claimed = await readCurrentShop(database, shop.id);

    if (
        claimed.tokenRefreshClaimId !== claimId ||
        claimed.tokenStatus !== "REFRESHING"
    ) {
        throw new ShopifyAuthStateChangedError();
    }

    return claimed;
}

async function persistRefreshedTokenPair({
    database,
    shop,
    claimId,
    refreshed,
    now = Date.now(),
}) {
    const result = await database.shop.updateMany({
        where: {
            id: shop.id,
            authVersion: getShopAuthVersion(shop),
            uninstalledAt: null,
            refreshToken: shop.refreshToken,
            tokenStatus: "REFRESHING",
            tokenRefreshClaimId: claimId,
        },
        data: {
            accessToken: refreshed.accessToken,
            accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
            refreshToken: refreshed.refreshToken,
            refreshTokenExpiresAt:
                refreshed.refreshTokenExpiresAt ||
                shop.refreshTokenExpiresAt,
            tokenType: "EXPIRING_OFFLINE",
            tokenStatus: "ACTIVE",
            lastTokenRefreshAt: new Date(now),
            tokenRefreshError: null,
            tokenRefreshClaimId: null,
            tokenRefreshClaimedAt: null,
        },
    });

    if (result.count !== 1) {
        throw new ShopifyAuthStateChangedError();
    }

    return readCurrentShop(database, shop.id);
}

async function finishRefreshFailure({
    database,
    shop,
    claimId,
    message,
}) {
    const result = await database.shop.updateMany({
        where: {
            id: shop.id,
            authVersion: getShopAuthVersion(shop),
            uninstalledAt: null,
            refreshToken: shop.refreshToken,
            tokenStatus: "REFRESHING",
            tokenRefreshClaimId: claimId,
        },
        data: {
            // The request might have reached Shopify even when its response
            // was lost. Never release this one-time token for another retry.
            tokenStatus: "REAUTH_REQUIRED",
            tokenRefreshError: message,
            tokenRefreshClaimId: null,
            tokenRefreshClaimedAt: null,
        },
    });

    if (result.count !== 1) {
        throw new ShopifyAuthStateChangedError();
    }
}

export async function exchangeIdTokenForOfflineToken({
    shop,
    idToken,
    fetchImpl = fetch,
    now = Date.now(),
}) {
    const shopDomain = normalizeShopDomain(shop);
    const apiKey = process.env.SHOPIFY_API_KEY;
    const apiSecret = process.env.SHOPIFY_API_SECRET;

    if (!shopDomain || !idToken || !apiKey || !apiSecret) {
        throw new ShopifyTokenExchangeError(
            "Shopify token exchange is not fully configured"
        );
    }

    const res = await fetchImpl(
        `https://${shopDomain}/admin/oauth/access_token`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Accept: "application/json",
            },
            body: new URLSearchParams({
                client_id: apiKey,
                client_secret: apiSecret,
                grant_type:
                    "urn:ietf:params:oauth:grant-type:token-exchange",
                subject_token: idToken,
                subject_token_type:
                    "urn:ietf:params:oauth:token-type:id_token",
                requested_token_type:
                    "urn:shopify:params:oauth:token-type:offline-access-token",
                expiring: "1",
            }),
        }
    );

    const data = await readTokenResponse(res);

    if (!res.ok) {
        throw new ShopifyTokenExchangeError(
            data.error_description ||
                data.error ||
                "Shopify token exchange failed",
            {
                status: res.status,
                retryInvalidSession: res.status === 400,
            }
        );
    }

    return requireExpiringOfflineTokenPair(data, now);
}

export async function exchangeOfflineToken({ shop, oldAccessToken }) {
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
        },
        body: new URLSearchParams({
            client_id: process.env.SHOPIFY_API_KEY,
            client_secret: process.env.SHOPIFY_API_SECRET,
            grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
            subject_token: oldAccessToken,
            subject_token_type:
                "urn:shopify:params:oauth:token-type:offline-access-token",
            requested_token_type:
                "urn:shopify:params:oauth:token-type:offline-access-token",
            expiring: "1",
        }),
    });

    const data = await res.json();

    if (!res.ok) {
        throw new Error(
            data.error_description || data.error || "Token exchange failed"
        );
    }

    return {
        accessToken: data.access_token,
        accessTokenExpiresAt: toExpiryDate(data.expires_in),
        refreshToken: data.refresh_token,
        refreshTokenExpiresAt: toExpiryDate(data.refresh_token_expires_in),
    };
}

export async function refreshOfflineToken({ shop, refreshToken }) {
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
        },
        body: new URLSearchParams({
            client_id: process.env.SHOPIFY_API_KEY,
            client_secret: process.env.SHOPIFY_API_SECRET,
            grant_type: "refresh_token",
            refresh_token: refreshToken,
        }),
    });

    const data = await res.json();

    if (!res.ok) {
        throw new Error(
            data.error_description || data.error || "Token refresh failed"
        );
    }

    return requireExpiringOfflineTokenPair(data);
}

export async function getValidOfflineToken(shop) {
    const bufferMs = 5 * 60 * 1000;

    if (!shop?.accessToken) {
        throw new Error("Missing access token");
    }

    // Old token path: keep working until migrated.
    if (shop.tokenType !== "EXPIRING_OFFLINE") {
        return shop.accessToken;
    }

    // Expiring token still valid.
    if (
        shop.accessTokenExpiresAt &&
        shop.accessTokenExpiresAt.getTime() > Date.now() + bufferMs
    ) {
        return shop.accessToken;
    }

    if (!shop.refreshToken) {
        throw new Error("Missing refresh token. Re-auth required.");
    }

    if (
        shop.refreshTokenExpiresAt &&
        shop.refreshTokenExpiresAt.getTime() <= Date.now() + bufferMs
    ) {
        await markRefreshFailureIfCurrent({
            database: prisma,
            shop,
            message: "Refresh token expired. Re-auth required.",
        });

        throw new Error("Refresh token expired. Re-auth required.");
    }

    const updated = await refreshAndSaveOfflineToken(shop);

    return updated.accessToken;
}

export async function refreshAndSaveOfflineToken(
    shop,
    {
        database = prisma,
        refreshToken = refreshOfflineToken,
        now = Date.now(),
        createClaimId = randomUUID,
    } = {}
) {
    if (!shop?.refreshToken) {
        throw new Error("Missing refresh token. Re-auth required.");
    }

    if (shop.tokenStatus != null && shop.tokenStatus !== "ACTIVE") {
        throw new Error("Refresh token unavailable. Re-auth required.");
    }

    if (
        shop.refreshTokenExpiresAt &&
        shop.refreshTokenExpiresAt.getTime() <= now
    ) {
        await markRefreshFailureIfCurrent({
            database,
            shop,
            message: "Refresh token expired. Re-auth required.",
        });

        throw new Error("Refresh token expired. Re-auth required.");
    }

    const claimId = createClaimId();
    const claimedShop = await claimRefreshOwnership({
        database,
        shop,
        claimId,
        now,
    });

    let refreshed;

    try {
        refreshed = await refreshToken({
            shop: claimedShop.shopDomain,
            refreshToken: claimedShop.refreshToken,
        });
    } catch (error) {
        await finishRefreshFailure({
            database,
            shop: claimedShop,
            claimId,
            message: error.message || "Token refresh failed.",
        });

        throw error;
    }

    return persistRefreshedTokenPair({
        database,
        shop: claimedShop,
        claimId,
        refreshed,
        now,
    });
}
