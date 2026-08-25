import {
    exchangeIdTokenForOfflineToken,
    refreshAndSaveOfflineToken,
} from "./offlineTokens.js";
import {
    getShopAuthVersion,
    isPrismaUniqueConstraintError,
    ShopifyAuthStateChangedError,
    ShopifyTokenRefreshInProgressError,
} from "./shopifyAuthState.js";

const ACCESS_TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

function dateValue(value) {
    if (!value) return null;
    const time = value instanceof Date
        ? value.getTime()
        : new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
}

export function hasUsableExpiringOfflineCredentials(
    shop,
    now = Date.now()
) {
    const accessTokenExpiresAt = dateValue(shop?.accessTokenExpiresAt);
    const refreshTokenExpiresAt = dateValue(shop?.refreshTokenExpiresAt);

    return Boolean(
        shop &&
        !shop.uninstalledAt &&
        shop.accessToken &&
        shop.refreshToken &&
        shop.tokenType === "EXPIRING_OFFLINE" &&
        (shop.tokenStatus == null || shop.tokenStatus === "ACTIVE") &&
        accessTokenExpiresAt &&
        accessTokenExpiresAt > now + ACCESS_TOKEN_REFRESH_BUFFER_MS &&
        refreshTokenExpiresAt &&
        refreshTokenExpiresAt > now + ACCESS_TOKEN_REFRESH_BUFFER_MS
    );
}

function canRefreshOfflineCredentials(shop, now) {
    const refreshTokenExpiresAt = dateValue(shop?.refreshTokenExpiresAt);

    return Boolean(
        shop &&
        !shop.uninstalledAt &&
        shop.tokenType === "EXPIRING_OFFLINE" &&
        shop.refreshToken &&
        (shop.tokenStatus == null || shop.tokenStatus === "ACTIVE") &&
        refreshTokenExpiresAt &&
        refreshTokenExpiresAt > now + ACCESS_TOKEN_REFRESH_BUFFER_MS
    );
}

function authenticationState(credentials) {
    return {
        accessToken: credentials.accessToken,
        accessTokenExpiresAt: credentials.accessTokenExpiresAt,
        refreshToken: credentials.refreshToken,
        refreshTokenExpiresAt: credentials.refreshTokenExpiresAt,
        tokenType: "EXPIRING_OFFLINE",
        tokenStatus: "ACTIVE",
        tokenRefreshError: null,
        tokenRefreshClaimId: null,
        tokenRefreshClaimedAt: null,
        uninstalledAt: null,
    };
}

export async function persistCredentialPairForObservedState({
    prisma,
    shopDomain,
    observedShop,
    credentials,
    now = Date.now(),
}) {
    const nextAuthenticationState = authenticationState(credentials);

    if (!observedShop) {
        try {
            return await prisma.shop.create({
                data: {
                    shopDomain,
                    ...nextAuthenticationState,
                    authVersion: 1,
                    plan: "PAYMENT_REQUIRED",
                    installedAt: new Date(now),
                },
            });
        } catch (error) {
            if (isPrismaUniqueConstraintError(error)) {
                throw new ShopifyAuthStateChangedError();
            }
            throw error;
        }
    }

    const persisted = await prisma.shop.updateMany({
        where: {
            id: observedShop.id,
            authVersion: getShopAuthVersion(observedShop),
            uninstalledAt: observedShop.uninstalledAt,
        },
        data: {
            ...nextAuthenticationState,
            authVersion: {
                increment: 1,
            },
        },
    });

    if (persisted.count !== 1) {
        throw new ShopifyAuthStateChangedError();
    }

    const updated = await prisma.shop.findUnique({
        where: { id: observedShop.id },
    });

    if (!updated) {
        throw new ShopifyAuthStateChangedError();
    }

    return updated;
}

export async function ensureManagedInstallation({
    prisma,
    shopDomain,
    idToken,
    exchangeToken = exchangeIdTokenForOfflineToken,
    refreshToken = refreshAndSaveOfflineToken,
    now = Date.now(),
}) {
    let existing = await prisma.shop.findUnique({
        where: { shopDomain },
    });

    if (hasUsableExpiringOfflineCredentials(existing, now)) {
        return existing;
    }

    if (canRefreshOfflineCredentials(existing, now)) {
        try {
            const refreshed = await refreshToken(existing, {
                database: prisma,
            });

            if (hasUsableExpiringOfflineCredentials(refreshed, now)) {
                return refreshed;
            }
        } catch (error) {
            if (error instanceof ShopifyTokenRefreshInProgressError) {
                throw error;
            }
            if (error instanceof ShopifyAuthStateChangedError) {
                throw error;
            }
            // A current merchant ID token can recover an unusable refresh pair.
            existing = await prisma.shop.findUnique({
                where: { shopDomain },
            });
        }
    }

    const exchanged = await exchangeToken({
        shop: shopDomain,
        idToken,
    });

    return persistCredentialPairForObservedState({
        prisma,
        shopDomain,
        observedShop: existing,
        credentials: exchanged,
        now,
    });
}

export async function markShopUninstalled({
    prisma,
    shopDomain,
    uninstalledAt = new Date(),
}) {
    const uninstallState = {
        uninstalledAt,
        accessToken: null,
        accessTokenExpiresAt: null,
        refreshToken: null,
        refreshTokenExpiresAt: null,
        tokenStatus: "REAUTH_REQUIRED",
        tokenRefreshError: null,
        tokenRefreshClaimId: null,
        tokenRefreshClaimedAt: null,
        plan: "PAYMENT_REQUIRED",
        currentPlanHandle: null,
        currentSubscriptionId: null,
        currentSubscriptionStatus: null,
    };

    return prisma.shop.upsert({
        where: { shopDomain },
        update: {
            ...uninstallState,
            authVersion: {
                increment: 1,
            },
        },
        create: {
            shopDomain,
            ...uninstallState,
            authVersion: 1,
        },
    });
}
