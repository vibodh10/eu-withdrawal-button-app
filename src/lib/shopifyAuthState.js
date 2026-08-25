export class ShopifyAuthStateChangedError extends Error {
    constructor(message = "Shopify authentication state changed") {
        super(message);
        this.name = "ShopifyAuthStateChangedError";
    }
}

export class ShopifyTokenRefreshInProgressError extends Error {
    constructor(message = "Shopify token refresh is already in progress") {
        super(message);
        this.name = "ShopifyTokenRefreshInProgressError";
    }
}

export function getShopAuthVersion(shop) {
    const version = Number(shop?.authVersion);

    return Number.isInteger(version) && version >= 0
        ? version
        : 0;
}

export function isPrismaUniqueConstraintError(error) {
    return error?.code === "P2002";
}
