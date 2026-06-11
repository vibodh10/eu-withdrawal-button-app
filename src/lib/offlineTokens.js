import { prisma } from "./db.js";

function toExpiryDate(seconds) {
    if (!seconds) return null;
    return new Date(Date.now() + Number(seconds) * 1000);
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

    console.log("TOKEN EXCHANGE RESPONSE", data);

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

    return {
        accessToken: data.access_token,
        accessTokenExpiresAt: toExpiryDate(data.expires_in),
        refreshToken: data.refresh_token || refreshToken,
        refreshTokenExpiresAt: data.refresh_token_expires_in
            ? toExpiryDate(data.refresh_token_expires_in)
            : null,
    };
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
        throw new Error("Refresh token expired. Re-auth required.");
    }

    const refreshed = await refreshOfflineToken({
        shop: shop.shopDomain,
        refreshToken: shop.refreshToken,
    });

    const updated = await prisma.shop.update({
        where: { id: shop.id },
        data: {
            accessToken: refreshed.accessToken,
            accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
            refreshToken: refreshed.refreshToken,
            refreshTokenExpiresAt:
                refreshed.refreshTokenExpiresAt || shop.refreshTokenExpiresAt,
            tokenType: "EXPIRING_OFFLINE",
        },
    });

    return updated.accessToken;
}