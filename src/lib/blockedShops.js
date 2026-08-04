const SHOP_DOMAIN_PATTERN =
    /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function normalizeShopDomain(value) {
    const shopDomain = String(value || "")
        .trim()
        .toLowerCase();

    return SHOP_DOMAIN_PATTERN.test(shopDomain)
        ? shopDomain
        : null;
}

export function isShopBlocked(value) {
    const shopDomain = normalizeShopDomain(value);

    if (!shopDomain) {
        return false;
    }

    const blockedShops = new Set(
        String(process.env.BLOCKED_SHOPS || "")
            .split(",")
            .map(domain => domain.trim().toLowerCase())
            .filter(Boolean)
    );

    return blockedShops.has(shopDomain);
}