import crypto from "node:crypto";

import { prisma } from "./db.js";
import { AbuseProtectionError } from "./abuseProtectionErrors.js";

function countValue(rows) {
    return Number(rows?.[0]?.count ?? 0);
}

export class PrismaAbuseStore {
    constructor(prismaClient = prisma) {
        this.prisma = prismaClient;
    }

    async reserveCounters(category, rules, now = new Date()) {
        return this.prisma.$transaction(async (transaction) => {
            // A category-wide transaction lock makes a multi-scope reservation
            // all-or-nothing and gives all callers the same lock ordering.
            await transaction.$queryRaw`
                SELECT 1 AS "locked"
                FROM pg_advisory_xact_lock(
                    hashtextextended(${`abuse-counter:${category}`}, 0)
                )
            `;

            for (const rule of rules) {
                const windowStart = new Date(
                    Math.floor(now.getTime() / (rule.windowSeconds * 1000)) *
                    rule.windowSeconds * 1000
                );

                const rows = await transaction.$queryRaw`
                    INSERT INTO "AbuseCounter" (
                        "id", "category", "scope", "scopeKey",
                        "windowStart", "windowSeconds", "count",
                        "createdAt", "updatedAt"
                    ) VALUES (
                        ${crypto.randomUUID()}, ${category}, ${rule.scope},
                        ${rule.scopeKey}, ${windowStart}, ${rule.windowSeconds},
                        1, ${now}, ${now}
                    )
                    ON CONFLICT ("category", "scope", "scopeKey", "windowStart")
                    DO UPDATE SET
                        "count" = "AbuseCounter"."count" + 1,
                        "updatedAt" = EXCLUDED."updatedAt"
                    WHERE "AbuseCounter"."count" < ${rule.limit}
                    RETURNING "count"
                `;

                if (rows.length === 0) {
                    const windowEnd = windowStart.getTime() +
                        rule.windowSeconds * 1000;
                    throw new AbuseProtectionError(
                        "ABUSE_RATE_LIMITED",
                        "Request rate limit exceeded.",
                        {
                            retryAfterSeconds: Math.max(
                                1,
                                Math.ceil((windowEnd - now.getTime()) / 1000)
                            ),
                            scope: rule.scope,
                        }
                    );
                }
            }
        });
    }

    async acquireLease({
        category,
        shopKey = null,
        provider = null,
        limits,
        ttlSeconds,
        now = new Date(),
    }) {
        return this.prisma.$transaction(async (transaction) => {
            await transaction.$queryRaw`
                SELECT 1 AS "locked"
                FROM pg_advisory_xact_lock(
                    hashtextextended(${`abuse-lease:${category}`}, 0)
                )
            `;
            await transaction.$executeRaw`
                DELETE FROM "AbuseConcurrencyLease"
                WHERE "category" = ${category} AND "expiresAt" <= ${now}
            `;

            for (const limit of limits) {
                let rows;
                if (limit.scope === "GLOBAL") {
                    rows = await transaction.$queryRaw`
                        SELECT COUNT(*) AS "count"
                        FROM "AbuseConcurrencyLease"
                        WHERE "category" = ${category} AND "expiresAt" > ${now}
                    `;
                } else if (limit.scope === "SHOP") {
                    rows = await transaction.$queryRaw`
                        SELECT COUNT(*) AS "count"
                        FROM "AbuseConcurrencyLease"
                        WHERE "category" = ${category}
                          AND "shopKey" = ${shopKey}
                          AND "expiresAt" > ${now}
                    `;
                } else {
                    rows = await transaction.$queryRaw`
                        SELECT COUNT(*) AS "count"
                        FROM "AbuseConcurrencyLease"
                        WHERE "category" = ${category}
                          AND "provider" = ${provider}
                          AND "expiresAt" > ${now}
                    `;
                }

                if (countValue(rows) >= limit.limit) {
                    throw new AbuseProtectionError(
                        "ABUSE_CONCURRENCY_LIMITED",
                        "Too many requests are already in progress.",
                        {
                            retryAfterSeconds: ttlSeconds,
                            scope: limit.scope,
                        }
                    );
                }
            }

            const id = crypto.randomUUID();
            const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
            await transaction.$executeRaw`
                INSERT INTO "AbuseConcurrencyLease" (
                    "id", "category", "shopKey", "provider",
                    "expiresAt", "createdAt"
                ) VALUES (
                    ${id}, ${category}, ${shopKey}, ${provider},
                    ${expiresAt}, ${now}
                )
            `;
            return id;
        });
    }

    async releaseLease(id) {
        if (!id) return;
        await this.prisma.$executeRaw`
            DELETE FROM "AbuseConcurrencyLease" WHERE "id" = ${id}
        `;
    }

    async recordEmailDecision(decision) {
        const now = decision.now ?? new Date();
        await this.prisma.$transaction(async (transaction) => {
            if (
                decision.status === "IN_PROGRESS" &&
                decision.withdrawalRequestId
            ) {
                // This is the durable idempotency claim. A concurrent worker,
                // replay, or later retry cannot send a request already sent or
                // whose delivery outcome is currently uncertain.
                const claimed = await transaction.$queryRaw`
                    UPDATE "WithdrawalRequest" AS request
                    SET "emailStatus" = 'IN_PROGRESS',
                        "updatedAt" = ${now}
                    WHERE request."id" = ${decision.withdrawalRequestId}
                      AND request."emailStatus" NOT IN ('SENT', 'IN_PROGRESS')
                      AND EXISTS (
                          SELECT 1 FROM "Shop" AS shop
                          WHERE shop."id" = request."shopId"
                            AND LOWER(shop."shopDomain") =
                                LOWER(${decision.shopDomain ?? ""})
                      )
                    RETURNING request."id"
                `;

                if (claimed.length === 0) {
                    throw new AbuseProtectionError(
                        "EMAIL_DELIVERY_ALREADY_PROCESSED",
                        "Email delivery is already sent or in progress.",
                        { scope: "WITHDRAWAL_REQUEST" }
                    );
                }
            }

            await transaction.$executeRaw`
                INSERT INTO "EmailDeliveryDecision" (
                    "id", "withdrawalRequestId", "shopDomain",
                    "recipientHash", "provider", "status", "reason",
                    "createdAt"
                ) VALUES (
                    ${crypto.randomUUID()},
                    ${decision.withdrawalRequestId ?? null},
                    ${decision.shopDomain ?? null},
                    ${decision.recipientHash ?? null},
                    ${decision.provider ?? null},
                    ${decision.status},
                    ${decision.reason ?? null},
                    ${now}
                )
            `;

            if (
                decision.withdrawalRequestId &&
                decision.status !== "IN_PROGRESS"
            ) {
                if (decision.completesAttempt) {
                    await transaction.$executeRaw`
                        UPDATE "WithdrawalRequest" AS request
                        SET "emailStatus" = ${decision.status},
                            "emailProviderId" = CASE
                                WHEN ${decision.status} = 'SENT'
                                    THEN ${decision.providerId ?? null}
                                ELSE request."emailProviderId"
                            END,
                            "confirmationSentAt" = CASE
                                WHEN ${decision.status} = 'SENT' THEN ${now}
                                ELSE request."confirmationSentAt"
                            END,
                            "updatedAt" = ${now}
                        WHERE request."id" = ${decision.withdrawalRequestId}
                          AND request."emailStatus" = 'IN_PROGRESS'
                          AND EXISTS (
                              SELECT 1 FROM "Shop" AS shop
                              WHERE shop."id" = request."shopId"
                                AND LOWER(shop."shopDomain") =
                                    LOWER(${decision.shopDomain ?? ""})
                          )
                    `;
                } else {
                    await transaction.$executeRaw`
                        UPDATE "WithdrawalRequest" AS request
                        SET "emailStatus" = ${decision.status},
                            "updatedAt" = ${now}
                        WHERE request."id" = ${decision.withdrawalRequestId}
                          AND request."emailStatus" NOT IN ('SENT', 'IN_PROGRESS')
                          AND EXISTS (
                              SELECT 1 FROM "Shop" AS shop
                              WHERE shop."id" = request."shopId"
                                AND LOWER(shop."shopDomain") =
                                    LOWER(${decision.shopDomain ?? ""})
                          )
                    `;
                }
            }
        });
    }
}
