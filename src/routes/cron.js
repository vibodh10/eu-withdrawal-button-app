// /src/routes/cron.js
import express from "express";
import { prisma } from "../lib/db.js";
import { refreshAndSaveOfflineToken } from "../lib/offlineTokens.js";

const cronRouter = express.Router();

cronRouter.post("/refresh-shopify-tokens", async (req, res) => {
    if (req.headers["x-cron-secret"] !== process.env.CRON_SECRET) {
        return res.status(401).send("unauthorized");
    }

    const result = {
        success: true,
        checked: 0,
        refreshed: 0,
        failed: 0,
        failures: [],
    };

    try {
        const shops = await prisma.shop.findMany({
            where: {
                tokenType: "EXPIRING_OFFLINE",
                refreshToken: {
                    not: null,
                },
                uninstalledAt: null,
                OR: [
                    {
                        tokenStatus: null,
                    },
                    {
                        tokenStatus: "ACTIVE",
                    },
                ],
                refreshTokenExpiresAt: {
                    lte: new Date(
                        Date.now() + 1200 * 24 * 60 * 60 * 1000
                    ),
                },
            },
            orderBy: {
                refreshTokenExpiresAt: "asc",
            },
            take: 100,
        });

        result.checked = shops.length;

        for (const shop of shops) {
            try {
                await refreshAndSaveOfflineToken(shop);
                result.refreshed += 1;

                console.log(
                    `Token refreshed for ${shop.shopDomain}`
                );
            } catch (error) {
                result.failed += 1;

                result.failures.push({
                    shop: shop.shopDomain,
                    error:
                        error.message ||
                        "Unknown token refresh error",
                });

                console.error(
                    `Token refresh failed for ${shop.shopDomain}:`,
                    error
                );
            }
        }

        return res.json(result);
    } catch (error) {
        console.error("Token cron failed:", error);

        return res.status(500).json({
            success: false,
            error:
                error.message ||
                "Token cron failed.",
        });
    }
});

cronRouter.post("/cleanup", async (req, res) => {
    // 🔐 simple protection
    if (req.headers["x-cron-secret"] !== process.env.CRON_SECRET) {
        return res.status(401).send("unauthorized");
    }

    try {
        const result = await prisma.withdrawalRequest.deleteMany({
            where: {
                resolvedAt: {
                    lt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
                }
            }
        });

        console.log("Cleanup run:", result.count);

        res.json({ success: true, deleted: result.count });
    } catch (err) {
        console.error("Cleanup failed:", err);
        res.status(500).send("error");
    }
});

// cronRouter.post("/cleanup", async (req, res) => {
//     if (req.headers["x-cron-secret"] !== process.env.CRON_SECRET) {
//         return res.status(401).send("unauthorized");
//     }
//
//     try {
//         const threshold = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
//
//         const all = await prisma.withdrawalRequest.findMany({
//             select: {
//                 id: true,
//                 status: true,
//                 resolvedAt: true,
//                 customerEmail: true,
//             },
//         });
//
//         const eligible = await prisma.withdrawalRequest.findMany({
//             where: {
//                 resolvedAt: {
//                     lt: threshold,
//                 },
//             },
//             select: {
//                 id: true,
//                 status: true,
//                 resolvedAt: true,
//                 customerEmail: true,
//             },
//         });
//
//         const result = await prisma.withdrawalRequest.deleteMany({
//             where: {
//                 resolvedAt: {
//                     lt: threshold,
//                 },
//             },
//         });
//
//         console.log("Cleanup threshold:", threshold);
//         console.log("All requests:", all);
//         console.log("Eligible requests:", eligible);
//         console.log("Deleted:", result.count);
//
//         res.json({
//             success: true,
//             threshold,
//             allCount: all.length,
//             eligibleCount: eligible.length,
//             eligible,
//             deleted: result.count,
//         });
//     } catch (err) {
//         console.error("Cleanup failed:", err);
//         res.status(500).json({
//             success: false,
//             error: err.message,
//         });
//     }
// });

export default cronRouter;