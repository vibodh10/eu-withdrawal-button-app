import {
    getShopDomainFromSessionPayload,
    verifySessionToken,
} from "../lib/verifySessionToken.js";
import { prisma } from "../lib/db.js";
import {isShopBlocked} from "../lib/blockedShops.js";
import { ensureManagedInstallation } from "../lib/managedInstallation.js";
import { ShopifyTokenExchangeError } from "../lib/offlineTokens.js";
import {
    ShopifyAuthStateChangedError,
    ShopifyTokenRefreshInProgressError,
} from "../lib/shopifyAuthState.js";

function requestFreshSessionToken(res) {
    res.set("X-Shopify-Retry-Invalid-Session-Request", "1");
}

export function createVerifyRequest({
    verifyToken = verifySessionToken,
    getShopDomain = getShopDomainFromSessionPayload,
    isBlocked = isShopBlocked,
    ensureInstallation = ensureManagedInstallation,
    database = prisma,
} = {}) {
    return async function verifyRequest(req, res, next) {
        const authorization = req.headers.authorization || "";
        const token = authorization.startsWith("Bearer ")
            ? authorization.slice("Bearer ".length).trim()
            : null;

        if (!token) {
            requestFreshSessionToken(res);
            return res.status(401).send("No token");
        }

        let decoded;
        let shopDomain;

        try {
            decoded = await verifyToken(token);
            shopDomain = getShopDomain(decoded);
        } catch (err) {
            console.error("SESSION VERIFY FAILED:", err.message);
            requestFreshSessionToken(res);
            return res.status(401).send("Auth failed");
        }

        if (isBlocked(shopDomain)) {
            return res.status(403).send(
                "Store access unavailable"
            );
        }

        try {
            const shop = await ensureInstallation({
                prisma: database,
                shopDomain,
                idToken: token,
            });

            req.shop = shop;
            req.shopifySessionToken = decoded;

            return next();
        } catch (err) {
            console.error("SHOPIFY INSTALL AUTH FAILED:", err.message);

            if (
                err instanceof ShopifyTokenExchangeError &&
                err.retryInvalidSession
            ) {
                requestFreshSessionToken(res);
                return res.status(401).send("Auth failed");
            }

            if (err instanceof ShopifyAuthStateChangedError) {
                return res.status(409).send(
                    "Shopify installation state changed"
                );
            }

            if (err instanceof ShopifyTokenRefreshInProgressError) {
                res.set("Retry-After", "1");
                return res.status(409).send(
                    "Shopify token refresh is in progress"
                );
            }

            return res.status(502).send(
                "Could not establish Shopify access"
            );
        }
    };
}

export default createVerifyRequest();
