import test from "node:test";
import assert from "node:assert/strict";

import {
    ABUSE_LIMITS,
    AbuseProtection,
    AbuseProtectionError,
    executeProtectedEmail,
} from "../src/lib/abuseProtection.js";
import {
    buildWithdrawalSubmissionKey,
    findExistingWithdrawalRequest,
} from "../src/lib/withdrawalIdempotency.js";

process.env.ABUSE_HASH_SECRET ||=
    "test-only-abuse-hash-secret-32-characters";

function createBacking() {
    return {
        counters: new Map(),
        leases: new Map(),
        decisions: [],
        nextLease: 1,
        counterReservations: 0,
    };
}

class MemoryAbuseStore {
    constructor(backing = createBacking()) {
        this.backing = backing;
    }

    async reserveCounters(category, rules, now = new Date()) {
        const proposed = [];
        for (const rule of rules) {
            const windowStart = Math.floor(
                now.getTime() / (rule.windowSeconds * 1000)
            ) * rule.windowSeconds * 1000;
            const key = [
                category,
                rule.scope,
                rule.scopeKey,
                windowStart,
            ].join("|");
            const count = this.backing.counters.get(key) ?? 0;
            if (count >= rule.limit) {
                throw new AbuseProtectionError(
                    "ABUSE_RATE_LIMITED",
                    "Request rate limit exceeded.",
                    {
                        scope: rule.scope,
                        retryAfterSeconds: Math.max(
                            1,
                            Math.ceil(
                                (windowStart + rule.windowSeconds * 1000 -
                                    now.getTime()) / 1000
                            )
                        ),
                    }
                );
            }
            proposed.push([key, count + 1]);
        }
        for (const [key, count] of proposed) {
            this.backing.counters.set(key, count);
        }
        this.backing.counterReservations += 1;
    }

    async acquireLease({
        category,
        shopKey,
        provider,
        limits,
        ttlSeconds,
        now = new Date(),
    }) {
        for (const [id, lease] of this.backing.leases) {
            if (lease.expiresAt <= now.getTime()) {
                this.backing.leases.delete(id);
            }
        }

        const active = [...this.backing.leases.values()]
            .filter((lease) => lease.category === category);
        for (const limit of limits) {
            const count = active.filter((lease) => {
                if (limit.scope === "GLOBAL") return true;
                if (limit.scope === "SHOP") {
                    return lease.shopKey === shopKey;
                }
                return lease.provider === provider;
            }).length;
            if (count >= limit.limit) {
                throw new AbuseProtectionError(
                    "ABUSE_CONCURRENCY_LIMITED",
                    "Too many requests are already in progress.",
                    {
                        scope: limit.scope,
                        retryAfterSeconds: ttlSeconds,
                    }
                );
            }
        }

        const id = `lease-${this.backing.nextLease++}`;
        this.backing.leases.set(id, {
            category,
            shopKey,
            provider,
            expiresAt: now.getTime() + ttlSeconds * 1000,
        });
        return id;
    }

    async releaseLease(id) {
        this.backing.leases.delete(id);
    }

    async recordEmailDecision(decision) {
        this.backing.decisions.push(decision);
    }
}

function createProtection({ backing, mutateLimits } = {}) {
    const limits = structuredClone(ABUSE_LIMITS);
    mutateLimits?.(limits);
    return new AbuseProtection(
        new MemoryAbuseStore(backing),
        limits
    );
}

async function useSubmission(protection, context) {
    const lease = await protection.acquireSubmission(context);
    await protection.release(lease);
}

async function useEmail(protection, context) {
    const lease = await protection.acquireEmail(context);
    await protection.release(lease);
}

function isLimited(scope, code = "ABUSE_RATE_LIMITED") {
    return (error) =>
        error instanceof AbuseProtectionError &&
        error.code === code &&
        error.scope === scope;
}

test("the same Shopify order has one durable idempotency identity", async () => {
    const first = buildWithdrawalSubmissionKey(
        "Example-Shop.MyShopify.com",
        "gid://shopify/Order/123"
    );
    const afterReinstall = buildWithdrawalSubmissionKey(
        "example-shop.myshopify.com",
        "gid://shopify/Order/123"
    );
    assert.equal(first, afterReinstall);
    assert.notEqual(
        first,
        buildWithdrawalSubmissionKey(
            "example-shop.myshopify.com",
            "gid://shopify/Order/124"
        )
    );

    let receivedQuery;
    const existing = { publicReference: "WD-EXISTING", status: "RECEIVED" };
    const result = await findExistingWithdrawalRequest(
        {
            withdrawalRequest: {
                findFirst: async (query) => {
                    receivedQuery = query;
                    return existing;
                },
            },
        },
        "current-shop-row-id",
        "#1001",
        "BUYER@example.com"
    );
    assert.equal(result, existing);
    assert.deepEqual(
        receivedQuery.where.orderNumber.in,
        ["1001", "#1001"]
    );
    assert.equal(
        receivedQuery.where.customerEmail,
        "buyer@example.com"
    );

    const protection = createProtection();
    for (let replay = 0; replay < 5; replay += 1) {
        await useSubmission(protection, {
            shopDomain: "example-shop.myshopify.com",
            recipient: "buyer@example.com",
            orderId: "gid://shopify/Order/123",
        });
    }
    await assert.rejects(
        useSubmission(protection, {
            shopDomain: "example-shop.myshopify.com",
            recipient: "buyer@example.com",
            orderId: "gid://shopify/Order/123",
        }),
        isLimited("SHOP_RECIPIENT_DAILY")
    );
});

test("one shop cannot submit an unbounded burst of otherwise distinct orders", async () => {
    const protection = createProtection();
    for (let index = 0; index < 10; index += 1) {
        await useSubmission(protection, {
            shopDomain: "burst.myshopify.com",
            recipient: `buyer-${index}@example.com`,
        });
    }
    await assert.rejects(
        useSubmission(protection, {
            shopDomain: "burst.myshopify.com",
            recipient: "buyer-11@example.com",
        }),
        isLimited("SHOP_BURST")
    );
});

test("submission daily and global budgets are independent enforcement scopes", async () => {
    const daily = createProtection({
        mutateLimits: (limits) => {
            limits.submission.shopBurst.limit = 100;
            limits.submission.shopDaily.limit = 2;
            limits.submission.shopRecipientDaily.limit = 100;
            limits.submission.globalBurst.limit = 100;
        },
    });
    await useSubmission(daily, {
        shopDomain: "daily.myshopify.com",
        recipient: "one@example.com",
    });
    await useSubmission(daily, {
        shopDomain: "daily.myshopify.com",
        recipient: "two@example.com",
    });
    await assert.rejects(
        useSubmission(daily, {
            shopDomain: "daily.myshopify.com",
            recipient: "three@example.com",
        }),
        isLimited("SHOP_DAILY")
    );

    const global = createProtection({
        mutateLimits: (limits) => {
            limits.submission.shopBurst.limit = 100;
            limits.submission.shopDaily.limit = 100;
            limits.submission.shopRecipientDaily.limit = 100;
            limits.submission.globalBurst.limit = 2;
        },
    });
    await useSubmission(global, {
        shopDomain: "global-a.myshopify.com",
        recipient: "a@example.com",
    });
    await useSubmission(global, {
        shopDomain: "global-b.myshopify.com",
        recipient: "b@example.com",
    });
    await assert.rejects(
        useSubmission(global, {
            shopDomain: "global-c.myshopify.com",
            recipient: "c@example.com",
        }),
        isLimited("GLOBAL_BURST")
    );
});

test("email recipient and provider budgets block alternate abuse dimensions", async () => {
    const recipientProtection = createProtection();
    for (let index = 0; index < 3; index += 1) {
        await useEmail(recipientProtection, {
            shopDomain: `recipient-shop-${index}.myshopify.com`,
            recipient: "same-recipient@example.com",
            provider: "GL6_RESEND",
        });
    }
    await assert.rejects(
        useEmail(recipientProtection, {
            shopDomain: "recipient-shop-4.myshopify.com",
            recipient: "same-recipient@example.com",
            provider: "GL6_RESEND",
        }),
        isLimited("RECIPIENT_DAILY")
    );

    const providerProtection = createProtection({
        mutateLimits: (limits) => {
            limits.email.shopBurst.limit = 100;
            limits.email.shopDaily.limit = 100;
            limits.email.recipientDaily.limit = 100;
            limits.email.globalBurst.limit = 100;
            limits.email.provider.SMTP.burst.limit = 2;
        },
    });
    for (let index = 0; index < 2; index += 1) {
        await useEmail(providerProtection, {
            shopDomain: `smtp-${index}.myshopify.com`,
            recipient: `smtp-${index}@example.com`,
            provider: "SMTP",
        });
    }
    await assert.rejects(
        useEmail(providerProtection, {
            shopDomain: "smtp-3.myshopify.com",
            recipient: "smtp-3@example.com",
            provider: "SMTP",
        }),
        isLimited("PROVIDER_BURST_SMTP")
    );
});

test("concurrency leases cap a shop and expire safely after a crashed worker", async () => {
    const protection = createProtection();
    const now = new Date("2026-08-20T10:00:00.000Z");
    const first = await protection.acquireSubmission({
        shopDomain: "concurrent.myshopify.com",
        recipient: "first@example.com",
        now,
    });
    const second = await protection.acquireSubmission({
        shopDomain: "concurrent.myshopify.com",
        recipient: "second@example.com",
        now,
    });
    const third = await protection.acquireSubmission({
        shopDomain: "concurrent.myshopify.com",
        recipient: "third@example.com",
        now,
    });
    await assert.rejects(
        protection.acquireSubmission({
            shopDomain: "concurrent.myshopify.com",
            recipient: "fourth@example.com",
            now,
        }),
        isLimited("SHOP", "ABUSE_CONCURRENCY_LIMITED")
    );

    // Do not release the first three leases: advancing beyond the TTL models
    // workers crashing before their finally blocks run.
    const afterExpiry = await protection.acquireSubmission({
        shopDomain: "concurrent.myshopify.com",
        recipient: "fourth@example.com",
        now: new Date(now.getTime() + 121_000),
    });
    await protection.release(afterExpiry);
    await protection.release(first);
    await protection.release(second);
    await protection.release(third);
});

test("email concurrency includes a provider-wide cap", async () => {
    const protection = createProtection();
    const leases = [];
    for (let index = 0; index < 3; index += 1) {
        leases.push(await protection.acquireEmail({
            shopDomain: `smtp-concurrency-${index}.myshopify.com`,
            recipient: `smtp-concurrency-${index}@example.com`,
            provider: "SMTP",
        }));
    }
    await assert.rejects(
        protection.acquireEmail({
            shopDomain: "smtp-concurrency-4.myshopify.com",
            recipient: "smtp-concurrency-4@example.com",
            provider: "SMTP",
        }),
        isLimited("PROVIDER", "ABUSE_CONCURRENCY_LIMITED")
    );
    await Promise.all(leases.map((lease) => protection.release(lease)));
});

test("budgets survive process restart and shop uninstall/reinstall", async () => {
    const backing = createBacking();
    let protection = createProtection({ backing });
    for (let index = 0; index < 5; index += 1) {
        await useSubmission(protection, {
            shopDomain: "persistent.myshopify.com",
            recipient: "persistent@example.com",
            shopId: "old-shop-row",
        });
    }

    // A new service/store instance represents a restarted process. The new
    // shop ID represents reinstall; the stable domain remains the quota key.
    protection = createProtection({ backing });
    await assert.rejects(
        useSubmission(protection, {
            shopDomain: "PERSISTENT.myshopify.com",
            recipient: "persistent@example.com",
            shopId: "new-shop-row",
        }),
        isLimited("SHOP_RECIPIENT_DAILY")
    );
});

test("the email kill switch runs before quotas and records a deferred delivery", async () => {
    const backing = createBacking();
    const protection = createProtection({ backing });
    const previous = process.env.EMAIL_DELIVERY_ENABLED;
    delete process.env.EMAIL_DELIVERY_ENABLED;
    let providerCalls = 0;
    try {
        await assert.rejects(
            executeProtectedEmail({
                shopDomain: "disabled.myshopify.com",
                recipient: "buyer@example.com",
                provider: "GL6_RESEND",
                withdrawalRequestId: "request-1",
                protection,
                deliveryOperation: async () => {
                    providerCalls += 1;
                },
            }),
            (error) => error.code === "EMAIL_DELIVERY_DISABLED"
        );
    } finally {
        if (previous === undefined) {
            delete process.env.EMAIL_DELIVERY_ENABLED;
        } else {
            process.env.EMAIL_DELIVERY_ENABLED = previous;
        }
    }

    assert.equal(providerCalls, 0);
    assert.equal(backing.counterReservations, 0);
    assert.equal(backing.decisions.at(-1).status, "DEFERRED");
});

test("missing recipient-hash configuration fails closed before work", async () => {
    const backing = createBacking();
    const protection = createProtection({ backing });
    const previous = process.env.ABUSE_HASH_SECRET;
    delete process.env.ABUSE_HASH_SECRET;
    try {
        await assert.rejects(
            protection.acquireSubmission({
                shopDomain: "config.myshopify.com",
                recipient: "buyer@example.com",
            }),
            (error) => error.code === "ABUSE_CONFIG_INVALID"
        );
    } finally {
        process.env.ABUSE_HASH_SECRET = previous;
    }
    assert.equal(backing.counterReservations, 0);
    assert.equal(backing.leases.size, 0);
});

test("a rejected durable email claim prevents provider I/O", async () => {
    const previous = process.env.EMAIL_DELIVERY_ENABLED;
    process.env.EMAIL_DELIVERY_ENABLED = "true";
    const recorded = [];
    let providerCalls = 0;
    let releases = 0;
    const protection = {
        acquireEmail: async () => "claim-lease",
        release: async () => {
            releases += 1;
        },
        recordEmailDecision: async (decision) => {
            if (decision.status === "IN_PROGRESS") {
                throw new AbuseProtectionError(
                    "EMAIL_DELIVERY_ALREADY_PROCESSED",
                    "Already processed."
                );
            }
            recorded.push(decision.status);
        },
    };
    try {
        await assert.rejects(
            executeProtectedEmail({
                shopDomain: "claim.myshopify.com",
                recipient: "buyer@example.com",
                provider: "GL6_RESEND",
                withdrawalRequestId: "request-claim",
                protection,
                deliveryOperation: async () => {
                    providerCalls += 1;
                },
            }),
            (error) =>
                error.code === "EMAIL_DELIVERY_ALREADY_PROCESSED"
        );
    } finally {
        if (previous === undefined) {
            delete process.env.EMAIL_DELIVERY_ENABLED;
        } else {
            process.env.EMAIL_DELIVERY_ENABLED = previous;
        }
    }

    assert.equal(providerCalls, 0);
    assert.equal(releases, 1);
    assert.deepEqual(recorded, ["BLOCKED"]);
});

test("allowed, rate-limited, and failed deliveries record explicit outcomes", async () => {
    const backing = createBacking();
    const protection = createProtection({
        backing,
        mutateLimits: (limits) => {
            limits.email.shopBurst.limit = 1;
        },
    });
    const previous = process.env.EMAIL_DELIVERY_ENABLED;
    process.env.EMAIL_DELIVERY_ENABLED = "true";
    try {
        const sent = await executeProtectedEmail({
            shopDomain: "outcomes.myshopify.com",
            recipient: "sent@example.com",
            provider: "GL6_RESEND",
            protection,
            deliveryOperation: async () => ({ id: "provider-1" }),
        });
        assert.equal(sent.id, "provider-1");

        await assert.rejects(
            executeProtectedEmail({
                shopDomain: "outcomes.myshopify.com",
                recipient: "limited@example.com",
                provider: "GL6_RESEND",
                protection,
                deliveryOperation: async () => ({ id: "never" }),
            }),
            isLimited("SHOP_BURST")
        );

        await assert.rejects(
            executeProtectedEmail({
                shopDomain: "failure.myshopify.com",
                recipient: "failed@example.com",
                provider: "SMTP",
                protection,
                deliveryOperation: async () => {
                    throw new Error("provider failed");
                },
            }),
            /provider failed/
        );
    } finally {
        if (previous === undefined) {
            delete process.env.EMAIL_DELIVERY_ENABLED;
        } else {
            process.env.EMAIL_DELIVERY_ENABLED = previous;
        }
    }

    assert.deepEqual(
        backing.decisions.map((decision) => decision.status),
        [
            "IN_PROGRESS",
            "SENT",
            "RATE_LIMITED",
            "IN_PROGRESS",
            "FAILED",
        ]
    );
});
