import { verifySessionToken } from "../lib/verifySessionToken.js";
import { prisma } from "../lib/db.js";
import {isShopBlocked} from "../lib/blockedShops.js";

export default async function verifyRequest(req, res, next) {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) return res.status(401).send("No token");

    try {
        const decoded = await verifySessionToken(token);

        if (!decoded?.dest) {
            return res.status(401).send("Invalid token");
        }

        const shopDomain = decoded.dest.replace("https://", "");

        const shop = await prisma.shop.findUnique({
            where: { shopDomain },
        });

        if (
            !shop ||
            shop.uninstalledAt ||
            isShopBlocked(shopDomain)
        ) {
            return res.status(403).send(
                "Store access unavailable"
            );
        }

        req.shop = shop;

        next();
    } catch (err) {
        console.error("SESSION VERIFY FAILED:", err.message);
        return res.status(401).send("Auth failed");
    }
}