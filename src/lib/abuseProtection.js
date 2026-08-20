import crypto from "node:crypto";

import { assertEmailDeliveryEnabled, EmailDeliveryDisabledError } from "./emailDeliveryGuard.js";
import { AbuseProtectionError, isAbuseProtectionError } from "./abuseProtectionErrors.js";
import { PrismaAbuseStore } from "./prismaAbuseStore.js";

const DAY_SECONDS = 86_400;

export const ABUSE_LIMITS = Object.freeze({
    submission: {
        shopBurst: { limit: 10, windowSeconds: 300 },
        shopDaily: { limit: 100, windowSeconds: DAY_SECONDS },
        shopRecipientDaily: { limit: 5, windowSeconds: DAY_SECONDS },
        globalBurst: { limit: 300, windowSeconds: 60 },
        globalDaily: { limit: 10_000, windowSeconds: DAY_SECONDS },
        concurrency: { global: 50, shop: 3, ttlSeconds: 120 },
    },
    email: {
        shopBurst: { limit: 10, windowSeconds: 300 },
        shopDaily: { limit: 50, windowSeconds: DAY_SECONDS },
        recipientDaily: { limit: 3, windowSeconds: DAY_SECONDS },
        globalBurst: { limit: 50, windowSeconds: 60 },
        globalDaily: { limit: 1_000, windowSeconds: DAY_SECONDS },
        provider: {
            SMTP: {
                burst: { limit: 10, windowSeconds: 60 },
                daily: { limit: 250, windowSeconds: DAY_SECONDS },
                concurrency: 3,
            },
            RESEND: {
                burst: { limit: 30, windowSeconds: 60 },
                daily: { limit: 750, windowSeconds: DAY_SECONDS },
                concurrency: 5,
            },
        },
        concurrency: { global: 10, shop: 2, ttlSeconds: 120 },
    },
});

function normalizeShopDomain(value) {
    return String(value || "").trim().toLowerCase();
}

function normalizeRecipient(value) {
    return String(value || "").trim().toLowerCase();
}

export function hashRecipient(value) {
    const secret = process.env.ABUSE_HASH_SECRET;
    if (!secret || secret.length < 32) {
        throw new AbuseProtectionError(
            "ABUSE_CONFIG_INVALID",
            "ABUSE_HASH_SECRET must contain at least 32 characters."
        );
    }
    return crypto.createHmac("sha256", secret)
        .update(normalizeRecipient(value))
        .digest("hex");
}

function counterRule(scope, scopeKey, policy) {
    return { scope, scopeKey, ...policy };
}

export class AbuseProtection {
    constructor(store = new PrismaAbuseStore(), limits = ABUSE_LIMITS) {
        this.store = store;
        this.limits = limits;
    }

    async acquireSubmission({ shopDomain, recipient, now = new Date() }) {
        const shopKey = normalizeShopDomain(shopDomain);
        const normalizedRecipient = normalizeRecipient(recipient);
        if (!shopKey || !normalizedRecipient) {
            throw new AbuseProtectionError(
                "ABUSE_CONTEXT_INVALID",
                "Submission abuse-control context is incomplete."
            );
        }

        const policy = this.limits.submission;
        const leaseId = await this.store.acquireLease({
            category: "WITHDRAWAL_SUBMISSION",
            shopKey,
            limits: [
                { scope: "GLOBAL", limit: policy.concurrency.global },
                { scope: "SHOP", limit: policy.concurrency.shop },
            ],
            ttlSeconds: policy.concurrency.ttlSeconds,
            now,
        });

        try {
            await this.store.reserveCounters(
                "WITHDRAWAL_SUBMISSION",
                [
                    counterRule("SHOP_BURST", shopKey, policy.shopBurst),
                    counterRule("SHOP_DAILY", shopKey, policy.shopDaily),
                    counterRule(
                        "SHOP_RECIPIENT_DAILY",
                        `${shopKey}:${hashRecipient(normalizedRecipient)}`,
                        policy.shopRecipientDaily
                    ),
                    counterRule("GLOBAL_BURST", "GLOBAL", policy.globalBurst),
                    counterRule("GLOBAL_DAILY", "GLOBAL", policy.globalDaily),
                ],
                now
            );
        } catch (error) {
            try {
                await this.store.releaseLease(leaseId);
            } catch (releaseError) {
                console.error("Submission lease release failed:", {
                    message: releaseError?.message,
                });
            }
            throw error;
        }

        return leaseId;
    }

    async acquireEmail({ shopDomain, recipient, provider, now = new Date() }) {
        const shopKey = normalizeShopDomain(shopDomain);
        const normalizedRecipient = normalizeRecipient(recipient);
        const providerKey = String(provider || "").trim().toUpperCase();
        const providerBudgetKey = ["GL6_RESEND", "RESEND_DOMAIN"]
            .includes(providerKey)
            ? "RESEND"
            : providerKey;
        const providerPolicy =
            this.limits.email.provider[providerBudgetKey];
        if (!shopKey || !normalizedRecipient || !providerPolicy) {
            throw new AbuseProtectionError(
                "ABUSE_CONTEXT_INVALID",
                "Email abuse-control context is incomplete or invalid."
            );
        }

        const policy = this.limits.email;
        const leaseId = await this.store.acquireLease({
            category: "OUTBOUND_EMAIL",
            shopKey,
            provider: providerBudgetKey,
            limits: [
                { scope: "GLOBAL", limit: policy.concurrency.global },
                { scope: "SHOP", limit: policy.concurrency.shop },
                { scope: "PROVIDER", limit: providerPolicy.concurrency },
            ],
            ttlSeconds: policy.concurrency.ttlSeconds,
            now,
        });

        try {
            await this.store.reserveCounters(
                "OUTBOUND_EMAIL",
                [
                    counterRule("SHOP_BURST", shopKey, policy.shopBurst),
                    counterRule("SHOP_DAILY", shopKey, policy.shopDaily),
                    counterRule("RECIPIENT_DAILY", hashRecipient(normalizedRecipient), policy.recipientDaily),
                    counterRule("GLOBAL_BURST", "GLOBAL", policy.globalBurst),
                    counterRule("GLOBAL_DAILY", "GLOBAL", policy.globalDaily),
                    counterRule(`PROVIDER_BURST_${providerBudgetKey}`, providerBudgetKey, providerPolicy.burst),
                    counterRule(`PROVIDER_DAILY_${providerBudgetKey}`, providerBudgetKey, providerPolicy.daily),
                ],
                now
            );
        } catch (error) {
            try {
                await this.store.releaseLease(leaseId);
            } catch (releaseError) {
                console.error("Email lease release failed:", {
                    message: releaseError?.message,
                });
            }
            throw error;
        }

        return leaseId;
    }

    release(leaseId) {
        return this.store.releaseLease(leaseId);
    }

    recordEmailDecision(decision) {
        return this.store.recordEmailDecision({
            ...decision,
            shopDomain: decision.shopDomain
                ? normalizeShopDomain(decision.shopDomain)
                : null,
            recipientHash: decision.recipient
                ? hashRecipient(decision.recipient)
                : null,
        });
    }
}

export const abuseProtection = new AbuseProtection();

async function safelyRecord(protection, decision) {
    try {
        await protection.recordEmailDecision(decision);
    } catch (error) {
        console.error("Email delivery decision recording failed:", {
            status: decision.status,
            message: error?.message,
        });
    }
}

async function safelyRelease(protection, leaseId) {
    try {
        await protection.release(leaseId);
    } catch (error) {
        // Leases expire automatically. Never turn a successful provider call
        // into an apparent failure that a queue may retry and duplicate.
        console.error("Email concurrency lease release failed:", {
            message: error?.message,
        });
    }
}

export async function executeProtectedEmail({
    shopDomain,
    recipient,
    provider,
    withdrawalRequestId = null,
    deliveryOperation,
    protection = abuseProtection,
}) {
    const decisionBase = {
        shopDomain,
        recipient,
        provider,
        withdrawalRequestId,
    };

    try {
        assertEmailDeliveryEnabled();
    } catch (error) {
        await safelyRecord(protection, {
            ...decisionBase,
            status: "DEFERRED",
            reason: error.code,
        });
        throw error;
    }

    let leaseId;
    try {
        leaseId = await protection.acquireEmail({
            shopDomain,
            recipient,
            provider,
        });
    } catch (error) {
        const status = isAbuseProtectionError(error) &&
            error.code !== "ABUSE_CONTEXT_INVALID"
            ? "RATE_LIMITED"
            : "BLOCKED";
        await safelyRecord(protection, {
            ...decisionBase,
            status,
            reason: error.code || "ABUSE_PROTECTION_FAILURE",
        });
        throw error;
    }

    try {
        // Refuse provider I/O unless a durable pre-send state exists. If the
        // post-send update later fails, IN_PROGRESS means delivery is
        // uncertain and must be reconciled rather than blindly retried.
        await protection.recordEmailDecision({
            ...decisionBase,
            status: "IN_PROGRESS",
        });
    } catch (error) {
        await safelyRecord(protection, {
            ...decisionBase,
            status: "BLOCKED",
            reason: error.code || "DELIVERY_CLAIM_FAILED",
        });
        await safelyRelease(protection, leaseId);
        throw error;
    }

    try {
        const result = await deliveryOperation();
        await safelyRecord(protection, {
            ...decisionBase,
            status: "SENT",
            completesAttempt: true,
            providerId:
                result?.id ??
                result?.messageId ??
                result?.data?.id ??
                null,
        });
        return result;
    } catch (error) {
        await safelyRecord(protection, {
            ...decisionBase,
            status: error instanceof EmailDeliveryDisabledError
                ? "DEFERRED"
                : "FAILED",
            completesAttempt: true,
            reason: error.code || error.name || "DELIVERY_FAILED",
        });
        throw error;
    } finally {
        await safelyRelease(protection, leaseId);
    }
}

export { AbuseProtectionError, isAbuseProtectionError };
