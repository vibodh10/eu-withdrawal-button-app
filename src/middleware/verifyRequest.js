import { verifySessionToken } from "../lib/verifySessionToken.js";
import { prisma } from "../lib/db.js";

export default async function verifyRequest(req, res, next) {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) return res.status(401).send("No token");

    try {
        const decoded = await verifySessionToken(token);

        if (!decoded?.dest) {
            return res.status(401).send("Invalid token");
        }

        const shopDomain = decoded.dest.replace("https://", "");

        // 🔥 auto-create shop
        const shop = await prisma.shop.upsert({
            where: { shopDomain },
            update: {},
            create: {
                shopDomain,
                plan: "BASIC",
                installedAt: new Date(),
            },
        });

        req.shop = shop;

        next();
    } catch (err) {
        console.error("SESSION VERIFY FAILED:", err.message);
        return res.status(401).send("Auth failed");
    }
}