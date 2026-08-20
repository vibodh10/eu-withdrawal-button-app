import test from "node:test";
import assert from "node:assert/strict";

import {
    EmailDeliveryDisabledError,
    isEmailDeliveryEnabled,
} from "../src/lib/emailDeliveryGuard.js";

process.env.RESEND_API_KEY ||= "re_test_email_delivery_guard";
process.env.ABUSE_HASH_SECRET ||=
    "test-only-abuse-hash-secret-32-characters";

const { sendEmail } = await import("../src/lib/email.js");
const { sendCustomerConfirmation } = await import(
    "../src/lib/merchantEmail.js"
);

const message = {
    to: "recipient@example.com",
    from: "sender@example.com",
    subject: "Test",
    html: "<p>Test</p>",
};

function createAllowingProtection() {
    return {
        acquireEmail: async () => "test-lease",
        release: async () => {},
        recordEmailDecision: async () => {},
    };
}

const protection = createAllowingProtection();

const resendShop = {
    id: "shop-resend",
    shopDomain: "resend-shop.myshopify.com",
    plan: "PRO",
    emailDeliveryMethod: "RESEND_DOMAIN",
    resendDomainStatus: "verified",
    resendFromEmail: "sender@example.com",
};

const smtpShop = {
    id: "shop-smtp",
    shopDomain: "smtp-shop.myshopify.com",
    plan: "PRO",
    emailDeliveryMethod: "SMTP",
    smtpEnabled: true,
    smtpVerifiedAt: new Date(),
    smtpHost: "smtp.example.com",
    smtpPort: 587,
    smtpSecure: false,
    smtpUsername: "merchant@example.com",
    smtpPasswordEncrypted: "encrypted",
    smtpFromEmail: "merchant@example.com",
};

function isDisabledError(error) {
    return error instanceof EmailDeliveryDisabledError &&
        error.code === "EMAIL_DELIVERY_DISABLED";
}

async function withEmailDeliverySwitch(value, operation) {
    const key = "EMAIL_DELIVERY_ENABLED";
    const hadPreviousValue = Object.hasOwn(process.env, key);
    const previousValue = process.env[key];

    if (value === undefined) {
        delete process.env[key];
    } else {
        process.env[key] = value;
    }

    try {
        return await operation();
    } finally {
        if (hadPreviousValue) {
            process.env[key] = previousValue;
        } else {
            delete process.env[key];
        }
    }
}

test("only the exact string true enables delivery", async () => {
    await withEmailDeliverySwitch("true", () => {
        assert.equal(isEmailDeliveryEnabled(), true);
    });

    for (const value of [
        undefined,
        "",
        "false",
        "TRUE",
        "1",
        "yes",
        " true ",
    ]) {
        await withEmailDeliverySwitch(value, () => {
            assert.equal(
                isEmailDeliveryEnabled(),
                false,
                `${String(value)} must fail closed`
            );
        });
    }
});

test("shared Resend delivery cannot send when the switch is missing, disabled or malformed", async () => {
    for (const value of [undefined, "false", "TRUE", "1", " true "]) {
        let sends = 0;
        const resendClient = {
            emails: {
                send: async () => {
                    sends += 1;
                    return { data: { id: "unexpected" }, error: null };
                },
            },
        };

        await withEmailDeliverySwitch(value, async () => {
            await assert.rejects(
                sendEmail(message, {
                    resendClient,
                    protection,
                }),
                isDisabledError
            );
        });

        assert.equal(sends, 0);
    }
});

test("merchant-domain Resend delivery is blocked at its provider boundary", async () => {
    let sends = 0;

    await withEmailDeliverySwitch(undefined, async () => {
        await assert.rejects(
            sendCustomerConfirmation(
                {
                    shop: resendShop,
                    to: message.to,
                    subject: message.subject,
                    html: message.html,
                },
                {
                    protection,
                    resendClient: {
                        emails: {
                            send: async () => {
                                sends += 1;
                                return {
                                    data: { id: "unexpected" },
                                    error: null,
                                };
                            },
                        },
                    },
                }
            ),
            isDisabledError
        );
    });

    assert.equal(sends, 0);
});

test("SMTP delivery is blocked before DNS or transport preparation when disabled", async () => {
    let lookups = 0;
    let transports = 0;
    let sends = 0;

    await withEmailDeliverySwitch("false", async () => {
        await assert.rejects(
            sendCustomerConfirmation(
                {
                    shop: smtpShop,
                    to: message.to,
                    subject: message.subject,
                    html: message.html,
                },
                {
                    protection,
                    smtpTransportOptions: {
                        lookup: async () => {
                            lookups += 1;
                            return [{ address: "93.184.216.34", family: 4 }];
                        },
                        passwordResolver: () => "password",
                        transportFactory: () => {
                            transports += 1;
                            return {
                                sendMail: async () => {
                                    sends += 1;
                                },
                            };
                        },
                    },
                }
            ),
            isDisabledError
        );
    });

    assert.equal(lookups, 0);
    assert.equal(transports, 0);
    assert.equal(sends, 0);
});

test("SMTP rechecks the switch after asynchronous preparation", async () => {
    let sends = 0;

    await withEmailDeliverySwitch("true", async () => {
        await assert.rejects(
            sendCustomerConfirmation(
                {
                    shop: smtpShop,
                    to: message.to,
                    subject: message.subject,
                    html: message.html,
                },
                {
                    protection,
                    smtpTransportOptions: {
                        lookup: async () => {
                            process.env.EMAIL_DELIVERY_ENABLED = "false";
                            return [{ address: "93.184.216.34", family: 4 }];
                        },
                        passwordResolver: () => "password",
                        transportFactory: () => ({
                            sendMail: async () => {
                                sends += 1;
                            },
                        }),
                    },
                }
            ),
            isDisabledError
        );
    });

    assert.equal(sends, 0);
});

test("a queued delivery observes the switch value at execution time", async () => {
    let sends = 0;
    const resendClient = {
        emails: {
            send: async () => {
                sends += 1;
                return { data: { id: "unexpected" }, error: null };
            },
        },
    };

    await withEmailDeliverySwitch("true", async () => {
        const queuedDelivery = () => sendEmail(message, {
            resendClient,
            protection,
        });

        process.env.EMAIL_DELIVERY_ENABLED = "false";

        await assert.rejects(queuedDelivery(), isDisabledError);
    });
    assert.equal(sends, 0);
});

test("a retry is stopped when the switch changes after the first attempt", async () => {
    let sends = 0;
    const resendClient = {
        emails: {
            send: async () => {
                sends += 1;
                throw new Error("provider unavailable");
            },
        },
    };
    await withEmailDeliverySwitch("true", async () => {
        const attempt = () => sendEmail(message, {
            resendClient,
            protection,
        });

        await assert.rejects(attempt(), /provider unavailable/);
        assert.equal(sends, 1);

        process.env.EMAIL_DELIVERY_ENABLED = "false";

        await assert.rejects(attempt(), isDisabledError);
    });
    assert.equal(sends, 1);
});

test("a resolved Resend error is recorded as failed, never sent", async () => {
    const statuses = [];
    const trackingProtection = {
        acquireEmail: async () => "tracking-lease",
        release: async () => {},
        recordEmailDecision: async (decision) => {
            statuses.push(decision.status);
        },
    };

    await withEmailDeliverySwitch("true", async () => {
        await assert.rejects(
            sendEmail(message, {
                protection: trackingProtection,
                deliveryContext: {
                    shopDomain: "resend-error.myshopify.com",
                },
                resendClient: {
                    emails: {
                        send: async () => ({
                            data: null,
                            error: { message: "provider rejected" },
                        }),
                    },
                },
            }),
            /provider rejected/
        );
    });

    assert.deepEqual(statuses, ["IN_PROGRESS", "FAILED"]);
});

test("the guard permits fake Resend and SMTP transports only when explicitly enabled", async () => {
    let resendSends = 0;
    let smtpSends = 0;

    await withEmailDeliverySwitch("true", async () => {
        await sendEmail(message, {
            protection,
            deliveryContext: {
                shopDomain: "shared-email.myshopify.com",
            },
            resendClient: {
                emails: {
                    send: async () => {
                        resendSends += 1;
                        return { data: { id: "resend-test" }, error: null };
                    },
                },
            },
        });

        await sendCustomerConfirmation(
            {
                shop: smtpShop,
                to: message.to,
                subject: message.subject,
                html: message.html,
            },
            {
                protection,
                smtpTransportOptions: {
                    lookup: async () => [
                        { address: "93.184.216.34", family: 4 },
                    ],
                    passwordResolver: () => "password",
                    transportFactory: () => ({
                        sendMail: async () => {
                            smtpSends += 1;
                            return { id: "smtp-test" };
                        },
                    }),
                },
            }
        );
    });

    assert.equal(resendSends, 1);
    assert.equal(smtpSends, 1);
});
