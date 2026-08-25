import { jwtVerify } from "jose";
import { normalizeShopDomain } from "./blockedShops.js";

export function getShopDomainFromSessionPayload(payload) {
    let issuer;
    let destination;

    try {
        issuer = new URL(payload?.iss);
        destination = new URL(payload?.dest);
    } catch {
        throw new Error("Invalid Shopify session token destination");
    }

    const shopDomain = normalizeShopDomain(destination.hostname);

    if (
        issuer.protocol !== "https:" ||
        destination.protocol !== "https:" ||
        issuer.hostname.toLowerCase() !==
            destination.hostname.toLowerCase() ||
        !shopDomain
    ) {
        throw new Error("Invalid Shopify session token destination");
    }

    return shopDomain;
}

export async function verifySessionToken(token) {
    const apiKey = process.env.SHOPIFY_API_KEY;
    const apiSecret = process.env.SHOPIFY_API_SECRET;

    if (!apiKey || !apiSecret) {
        throw new Error("Shopify authentication is not configured");
    }

    const secret = new TextEncoder().encode(apiSecret);

    const { payload } = await jwtVerify(token, secret, {
        algorithms: ["HS256"],
        audience: apiKey,
    });

    if (
        !Number.isFinite(payload.exp) ||
        !Number.isFinite(payload.nbf)
    ) {
        throw new Error("Shopify session token is missing time claims");
    }

    getShopDomainFromSessionPayload(payload);

    return payload;
}
