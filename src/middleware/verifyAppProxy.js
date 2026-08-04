import crypto from "node:crypto";
import {
    normalizeShopDomain,
    isShopBlocked,
} from "../lib/blockedShops.js";

export function verifyAppProxy(req, res, next) {
    try {
        const signature =
            typeof req.query.signature === "string"
                ? req.query.signature
                : "";

        const shopDomain =
            normalizeShopDomain(req.query.shop);

        const timestamp =
            Number(req.query.timestamp);

        if (
            !shopDomain ||
            !Number.isFinite(timestamp) ||
            !/^[a-f0-9]{64}$/i.test(signature)
        ) {
            return res.status(401).json({
                error: "Unauthorised request",
            });
        }

        // Reject replayed signed requests.
        const ageSeconds = Math.abs(
            Math.floor(Date.now() / 1000) - timestamp
        );

        if (ageSeconds > 300) {
            return res.status(401).json({
                error: "Expired request",
            });
        }

        const message = Object.entries(req.query)
            .filter(([key]) => key !== "signature")
            .map(([key, value]) => {
                const normalizedValue = Array.isArray(value)
                    ? value.map(String).join(",")
                    : String(value);

                return `${key}=${normalizedValue}`;
            })
            .sort()
            .join("");

        const expected = crypto
            .createHmac(
                "sha256",
                process.env.SHOPIFY_API_SECRET
            )
            .update(message)
            .digest("hex");

        const suppliedBuffer =
            Buffer.from(signature, "hex");

        const expectedBuffer =
            Buffer.from(expected, "hex");

        if (
            suppliedBuffer.length !== expectedBuffer.length ||
            !crypto.timingSafeEqual(
                suppliedBuffer,
                expectedBuffer
            )
        ) {
            return res.status(401).json({
                error: "Unauthorised request",
            });
        }

        if (isShopBlocked(shopDomain)) {
            return res.status(403).json({
                error: "Store access suspended",
            });
        }

        req.shopDomain = shopDomain;
        return next();
    } catch (error) {
        console.error("App proxy validation failed:", {
            message: error?.message,
        });

        return res.status(401).json({
            error: "Unauthorised request",
        });
    }
}