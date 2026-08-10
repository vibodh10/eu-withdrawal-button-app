// /src/routes/cron.js
import express from "express";
import { prisma } from "../lib/db.js";
import { refreshAndSaveOfflineToken } from "../lib/offlineTokens.js";
import crypto from "node:crypto";
import {
    recordDataAccess
} from "../lib/dataAccessAudit.js";

const cronRouter = express.Router();

function requireCronSecret(
    req,
    res,
    next
) {
    const expected =
        process.env.CRON_SECRET;

    const received =
        req.get("x-cron-secret");

    if (!expected) {
        console.error(
            "CRON_SECRET is not configured."
        );

        return res.status(503).json({
            error:
                "Cron authentication is unavailable.",
        });
    }

    if (!received) {
        return res.status(401).json({
            error: "Unauthorized",
        });
    }

    const expectedBuffer =
        Buffer.from(expected, "utf8");

    const receivedBuffer =
        Buffer.from(received, "utf8");

    if (
        expectedBuffer.length !==
        receivedBuffer.length ||
        !crypto.timingSafeEqual(
            expectedBuffer,
            receivedBuffer
        )
    ) {
        return res.status(401).json({
            error: "Unauthorized",
        });
    }

    return next();
}

cronRouter.post(
    "/refresh-shopify-tokens",
    requireCronSecret,
    async (req, res) => {

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
                        Date.now() + 14 * 24 * 60 * 60 * 1000
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

cronRouter.post(
    "/cleanup",
    requireCronSecret,
    async (req, res) => {

    try {
        const threshold = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

        const result =
            await prisma.$transaction(
                async (tx) => {
                    const deleted =
                        await tx.withdrawalRequest
                            .deleteMany({
                                where: {
                                    status: {
                                        in: [
                                            "APPROVED",
                                            "REJECTED",
                                        ],
                                    },

                                    resolvedAt: {
                                        lt: threshold,
                                    },
                                },
                            });

                    await recordDataAccess({
                        db: tx,
                        action:
                            "RETENTION_CLEANUP",
                        recordCount:
                        deleted.count,
                        actorType:
                            "SYSTEM_CRON",
                        reason:
                            "Automatic deletion of resolved requests older than 60 days",
                    });

                    return deleted;
                }
            );

        console.log("Cleanup run:", result.count);

        res.json({ success: true, deleted: result.count });
    } catch (err) {
        console.error("Cleanup failed:", err);
        res.status(500).send("error");
    }
});

export default cronRouter;
