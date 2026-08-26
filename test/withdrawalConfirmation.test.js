import test from "node:test";
import assert from "node:assert/strict";

process.env.RESEND_API_KEY ||= "re_test_withdrawal_confirmation";
process.env.ABUSE_HASH_SECRET ||=
    "test-only-abuse-hash-secret-32-characters";
process.env.FROM_EMAIL ||= "hello@gl6.com";

const { AbuseProtectionError } = await import(
    "../src/lib/abuseProtection.js"
);
const { sendEmail } = await import("../src/lib/email.js");
const { sendCustomerConfirmation } = await import(
    "../src/lib/merchantEmail.js"
);
const { sendVerifiedWithdrawalConfirmation } = await import(
    "../src/lib/withdrawalConfirmation.js"
);

const VERIFIED_EMAIL = "verified-buyer@example.com";

function baseShop(overrides = {}) {
    return {
        id: "shop-1",
        shopDomain: "confirmation-shop.myshopify.com",
        brandingName: "Confirmation Shop",
        supportEmail: "support@merchant.example",
        plan: "BASIC",
        emailDeliveryMethod: "GL6",
        ...overrides,
    };
}

function baseWithdrawal(overrides = {}) {
    return {
        id: "withdrawal-1",
        publicReference: "WD-CONFIRM123",
        customerEmail: VERIFIED_EMAIL,
        verificationStatus: "VERIFIED",
        locale: "en",
        emailStatus: "PENDING",
        confirmationSentAt: null,
        emailProviderId: null,
        ...overrides,
    };
}

class DurableEmailProtection {
    constructor(withdrawalRequest, { acquireError = null } = {}) {
        this.withdrawalRequest = withdrawalRequest;
        this.acquireError = acquireError;
        this.decisions = [];
        this.acquireCalls = 0;
        this.releaseCalls = 0;
    }

    async acquireEmail() {
        this.acquireCalls += 1;
        if (this.acquireError) throw this.acquireError;
        return `lease-${this.acquireCalls}`;
    }

    async release() {
        this.releaseCalls += 1;
    }

    async recordEmailDecision(decision) {
        this.decisions.push({ ...decision });
        const request = this.withdrawalRequest;
        if (decision.withdrawalRequestId !== request.id) {
            throw new AbuseProtectionError(
                "EMAIL_DELIVERY_CONTEXT_INVALID",
                "Withdrawal request does not match."
            );
        }

        if (decision.status === "IN_PROGRESS") {
            if (["SENT", "IN_PROGRESS"].includes(request.emailStatus)) {
                throw new AbuseProtectionError(
                    "EMAIL_DELIVERY_ALREADY_PROCESSED",
                    "Email delivery is already sent or in progress."
                );
            }
            request.emailStatus = "IN_PROGRESS";
            return;
        }

        if (decision.completesAttempt) {
            if (request.emailStatus === "IN_PROGRESS") {
                request.emailStatus = decision.status;
                if (decision.status === "SENT") {
                    request.confirmationSentAt = new Date();
                    request.emailProviderId = decision.providerId || null;
                }
            }
            return;
        }

        if (!["SENT", "IN_PROGRESS"].includes(request.emailStatus)) {
            request.emailStatus = decision.status;
        }
    }
}

async function withDeliverySwitch(value, operation) {
    const key = "EMAIL_DELIVERY_ENABLED";
    const hadPrevious = Object.hasOwn(process.env, key);
    const previous = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;

    try {
        return await operation();
    } finally {
        if (hadPrevious) process.env[key] = previous;
        else delete process.env[key];
    }
}

function gl6SenderUsing(resendClient) {
    return (message, { protection, deliveryContext }) => sendEmail(
        message,
        { resendClient, protection, deliveryContext }
    );
}

function sendWith({
    shop = baseShop(),
    withdrawalRequest,
    protection,
    verifiedOrderEmail = VERIFIED_EMAIL,
    resendClient,
    smtpTransportOptions,
}) {
    return sendVerifiedWithdrawalConfirmation({
        shop,
        withdrawalRequest,
        verifiedOrderEmail,
    }, {
        sendConfirmation: (message) => sendCustomerConfirmation(
            message,
            {
                protection,
                resendClient,
                smtpTransportOptions,
                ...(resendClient
                    ? { gl6Sender: gl6SenderUsing(resendClient) }
                    : {}),
            }
        ),
    });
}

test("a successfully verified durable withdrawal sends one fixed confirmation", async () => {
    const withdrawalRequest = baseWithdrawal();
    const protection = new DurableEmailProtection(withdrawalRequest);
    const deliveries = [];
    const resendClient = {
        emails: {
            send: async (message) => {
                deliveries.push(message);
                return { data: { id: "gl6-confirmation-1" }, error: null };
            },
        },
    };

    await withDeliverySwitch("true", () => sendWith({
        withdrawalRequest,
        protection,
        resendClient,
    }));

    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].to, VERIFIED_EMAIL);
    assert.equal(
        deliveries[0].subject,
        "Your withdrawal request has been received"
    );
    assert.match(deliveries[0].html, /WD-CONFIRM123/);
    assert.equal(withdrawalRequest.emailStatus, "SENT");
    assert.equal(withdrawalRequest.emailProviderId, "gl6-confirmation-1");
    assert.ok(withdrawalRequest.confirmationSentAt);
    assert.deepEqual(
        protection.decisions.map((decision) => decision.status),
        ["IN_PROGRESS", "SENT"]
    );
});

test("a duplicate or replayed withdrawal cannot send a second confirmation", async () => {
    const withdrawalRequest = baseWithdrawal();
    const protection = new DurableEmailProtection(withdrawalRequest);
    let sends = 0;
    const resendClient = {
        emails: {
            send: async () => {
                sends += 1;
                return { data: { id: `send-${sends}` }, error: null };
            },
        },
    };

    await withDeliverySwitch("true", async () => {
        await sendWith({ withdrawalRequest, protection, resendClient });
        await assert.rejects(
            sendWith({ withdrawalRequest, protection, resendClient }),
            (error) => error.code === "EMAIL_DELIVERY_ALREADY_PROCESSED"
        );
    });

    assert.equal(sends, 1);
    assert.equal(withdrawalRequest.emailStatus, "SENT");
});

test("concurrent confirmation attempts acquire one durable sender", async () => {
    const withdrawalRequest = baseWithdrawal();
    const protection = new DurableEmailProtection(withdrawalRequest);
    let releaseProvider;
    let signalProviderStarted;
    const providerReleased = new Promise((resolve) => {
        releaseProvider = resolve;
    });
    const providerStarted = new Promise((resolve) => {
        signalProviderStarted = resolve;
    });
    let sends = 0;
    const resendClient = {
        emails: {
            send: async () => {
                sends += 1;
                signalProviderStarted();
                await providerReleased;
                return { data: { id: "concurrent-send" }, error: null };
            },
        },
    };

    await withDeliverySwitch("true", async () => {
        const winner = sendWith({
            withdrawalRequest,
            protection,
            resendClient,
        });
        await providerStarted;
        await assert.rejects(
            sendWith({ withdrawalRequest, protection, resendClient }),
            (error) => error.code === "EMAIL_DELIVERY_ALREADY_PROCESSED"
        );
        releaseProvider();
        await winner;
    });

    assert.equal(sends, 1);
    assert.equal(withdrawalRequest.emailStatus, "SENT");
});

test("kill switch OFF defers email without removing the durable withdrawal", async () => {
    const withdrawalRequest = baseWithdrawal();
    const protection = new DurableEmailProtection(withdrawalRequest);
    let sends = 0;
    const resendClient = {
        emails: {
            send: async () => {
                sends += 1;
                return { data: { id: "unexpected" }, error: null };
            },
        },
    };

    await withDeliverySwitch("false", async () => {
        await assert.rejects(
            sendWith({ withdrawalRequest, protection, resendClient }),
            (error) => error.code === "EMAIL_DELIVERY_DISABLED"
        );
    });

    assert.equal(sends, 0);
    assert.equal(withdrawalRequest.id, "withdrawal-1");
    assert.equal(withdrawalRequest.emailStatus, "DEFERRED");
    assert.deepEqual(
        protection.decisions.map((decision) => decision.status),
        ["DEFERRED"]
    );
});

test("an arbitrary email cannot replace the persisted Shopify-verified recipient", async () => {
    const withdrawalRequest = baseWithdrawal();
    const protection = new DurableEmailProtection(withdrawalRequest);
    let sends = 0;
    const resendClient = {
        emails: {
            send: async () => {
                sends += 1;
                return { data: { id: "unexpected" }, error: null };
            },
        },
    };

    await withDeliverySwitch("true", async () => {
        await assert.rejects(
            sendWith({
                withdrawalRequest,
                protection,
                resendClient,
                verifiedOrderEmail: "attacker@example.com",
            }),
            (error) =>
                error.code === "WITHDRAWAL_CONFIRMATION_CONTEXT_INVALID"
        );
    });

    assert.equal(sends, 0);
    assert.equal(withdrawalRequest.emailStatus, "PENDING");
});

test("rate-limited confirmation records the outcome and performs no provider I/O", async () => {
    const withdrawalRequest = baseWithdrawal();
    const protection = new DurableEmailProtection(withdrawalRequest, {
        acquireError: new AbuseProtectionError(
            "ABUSE_RATE_LIMITED",
            "Email rate limit exceeded.",
            { scope: "SHOP_BURST", retryAfterSeconds: 60 }
        ),
    });
    let sends = 0;
    const resendClient = {
        emails: {
            send: async () => {
                sends += 1;
                return { data: { id: "unexpected" }, error: null };
            },
        },
    };

    await withDeliverySwitch("true", async () => {
        await assert.rejects(
            sendWith({ withdrawalRequest, protection, resendClient }),
            (error) => error.code === "ABUSE_RATE_LIMITED"
        );
    });

    assert.equal(sends, 0);
    assert.equal(withdrawalRequest.emailStatus, "RATE_LIMITED");
    assert.equal(protection.decisions.at(-1).status, "RATE_LIMITED");
});

test("Resend-domain, merchant SMTP, and GL6 fallback routes remain guarded", async () => {
    await withDeliverySwitch("true", async () => {
        const resendRequest = baseWithdrawal({ id: "resend-request" });
        const resendProtection = new DurableEmailProtection(resendRequest);
        const resendMessages = [];
        await sendWith({
            shop: baseShop({
                plan: "PRO",
                emailDeliveryMethod: "RESEND_DOMAIN",
                resendDomainStatus: "verified",
                resendFromEmail: "confirm@merchant.example",
                resendFromName: "Merchant Resend",
            }),
            withdrawalRequest: resendRequest,
            protection: resendProtection,
            resendClient: {
                emails: {
                    send: async (message) => {
                        resendMessages.push(message);
                        return {
                            data: { id: "merchant-resend" },
                            error: null,
                        };
                    },
                },
            },
        });
        assert.equal(
            resendProtection.decisions[0].provider,
            "RESEND_DOMAIN"
        );
        assert.equal(
            resendMessages[0].from,
            "Merchant Resend <confirm@merchant.example>"
        );

        const smtpRequest = baseWithdrawal({ id: "smtp-request" });
        const smtpProtection = new DurableEmailProtection(smtpRequest);
        const smtpMessages = [];
        await sendWith({
            shop: baseShop({
                plan: "PRO",
                emailDeliveryMethod: "SMTP",
                smtpEnabled: true,
                smtpVerifiedAt: new Date(),
                smtpHost: "smtp.merchant.example",
                smtpPort: 587,
                smtpSecure: false,
                smtpUsername: "smtp-user@merchant.example",
                smtpPasswordEncrypted: "encrypted",
                smtpFromEmail: "mail@merchant.example",
                smtpFromName: "Merchant SMTP",
            }),
            withdrawalRequest: smtpRequest,
            protection: smtpProtection,
            smtpTransportOptions: {
                lookup: async () => [
                    { address: "93.184.216.34", family: 4 },
                ],
                passwordResolver: () => "password",
                transportFactory: () => ({
                    sendMail: async (message) => {
                        smtpMessages.push(message);
                        return { messageId: "merchant-smtp" };
                    },
                }),
            },
        });
        assert.equal(smtpProtection.decisions[0].provider, "SMTP");
        assert.equal(
            smtpMessages[0].from,
            '"Merchant SMTP" <mail@merchant.example>'
        );
        assert.doesNotMatch(smtpMessages[0].from, /hello@gl6\.com/);

        const gl6Request = baseWithdrawal({ id: "gl6-request" });
        const gl6Protection = new DurableEmailProtection(gl6Request);
        const gl6Messages = [];
        await sendWith({
            withdrawalRequest: gl6Request,
            protection: gl6Protection,
            resendClient: {
                emails: {
                    send: async (message) => {
                        gl6Messages.push(message);
                        return { data: { id: "gl6-fallback" }, error: null };
                    },
                },
            },
        });
        assert.equal(gl6Protection.decisions[0].provider, "GL6_RESEND");
        assert.equal(
            gl6Messages[0].from,
            "Confirmation Shop via GL6 <hello@gl6.com>"
        );
        assert.equal(
            gl6Messages[0].replyTo,
            "support@merchant.example"
        );
    });
});

test("provider failure preserves the withdrawal and records FAILED safely", async () => {
    const withdrawalRequest = baseWithdrawal();
    const protection = new DurableEmailProtection(withdrawalRequest);
    let sends = 0;
    const resendClient = {
        emails: {
            send: async () => {
                sends += 1;
                return {
                    data: null,
                    error: { message: "provider rejected" },
                };
            },
        },
    };

    await withDeliverySwitch("true", async () => {
        await assert.rejects(
            sendWith({ withdrawalRequest, protection, resendClient }),
            /provider rejected/
        );
    });

    assert.equal(sends, 1);
    assert.equal(withdrawalRequest.id, "withdrawal-1");
    assert.equal(withdrawalRequest.emailStatus, "FAILED");
    assert.deepEqual(
        protection.decisions.map((decision) => decision.status),
        ["IN_PROGRESS", "FAILED"]
    );
});
