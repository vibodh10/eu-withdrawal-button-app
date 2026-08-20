import test from "node:test";
import assert from "node:assert/strict";

import {
    isAllowedSmtpPort,
    isPublicIpAddress,
    resolvePublicSmtpDestination,
    SmtpSecurityError,
    SmtpVerificationLimiter,
    SmtpVerificationLimitError,
} from "../src/lib/smtpSecurity.js";

process.env.RESEND_API_KEY ||= "re_test_smtp_security";

const { verifyMerchantSmtp } = await import(
    "../src/lib/merchantEmail.js"
);

const privateAndReservedIpv4 = [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.1.1",
    "169.254.169.254",
    "168.63.129.16",
    "100.100.100.200",
    "0.0.0.0",
    "198.18.0.1",
    "192.0.2.1",
    "224.0.0.1",
    "255.255.255.255",
];

const privateAndReservedIpv6 = [
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fd00:ec2::254",
    "fe80::1",
    "fec0::1",
    "ff02::1",
    "2001:db8::1",
    "2002:7f00:1::",
];

test("rejects loopback, private, link-local, metadata and reserved IPv4", () => {
    for (const address of privateAndReservedIpv4) {
        assert.equal(
            isPublicIpAddress(address),
            false,
            `${address} must be rejected`
        );
    }
});

test("rejects IPv6 loopback, private, link-local, multicast and mapped private IPv4", () => {
    for (const address of privateAndReservedIpv6) {
        assert.equal(
            isPublicIpAddress(address),
            false,
            `${address} must be rejected`
        );
    }
});

test("accepts ordinary public IPv4 and IPv6 addresses", () => {
    assert.equal(isPublicIpAddress("8.8.8.8"), true);
    assert.equal(isPublicIpAddress("93.184.216.34"), true);
    assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);
});

test("rejects localhost before attempting DNS", async () => {
    let lookupCalled = false;

    await assert.rejects(
        resolvePublicSmtpDestination("localhost", {
            lookup: async () => {
                lookupCalled = true;
                return [{ address: "127.0.0.1", family: 4 }];
            },
        }),
        error => error instanceof SmtpSecurityError &&
            error.code === "SMTP_DESTINATION_REJECTED"
    );

    assert.equal(lookupCalled, false);
});

test("accepts a public SMTP hostname and returns a pinned address", async () => {
    const destination = await resolvePublicSmtpDestination(
        "smtp.example.com",
        {
            lookup: async host => {
                assert.equal(host, "smtp.example.com");
                return [
                    { address: "93.184.216.34", family: 4 },
                    { address: "2606:4700:4700::1111", family: 6 },
                ];
            },
        }
    );

    assert.equal(destination.address, "93.184.216.34");
    assert.equal(destination.servername, "smtp.example.com");
    assert.deepEqual(destination.addresses, [
        "93.184.216.34",
        "2606:4700:4700::1111",
    ]);
});

test("rejects malicious DNS when any answer is non-public", async () => {
    await assert.rejects(
        resolvePublicSmtpDestination("smtp.attacker.example", {
            lookup: async () => [
                { address: "93.184.216.34", family: 4 },
                { address: "127.0.0.1", family: 4 },
            ],
        }),
        error => error instanceof SmtpSecurityError &&
            error.code === "SMTP_DESTINATION_REJECTED"
    );
});

test("allows only SMTP submission ports 465 and 587", () => {
    assert.equal(isAllowedSmtpPort(465), true);
    assert.equal(isAllowedSmtpPort("587"), true);
    assert.equal(isAllowedSmtpPort(25), false);
    assert.equal(isAllowedSmtpPort(2525), false);
    assert.equal(isAllowedSmtpPort(80), false);
    assert.equal(isAllowedSmtpPort(65535), false);
});

test("verification connects to the pinned public IP and preserves TLS servername", async () => {
    let capturedOptions;
    let closed = false;

    await verifyMerchantSmtp(
        {
            smtpHost: "smtp.example.com",
            smtpPort: 587,
            smtpSecure: false,
            smtpUsername: "merchant@example.com",
            smtpPasswordEncrypted: "encrypted",
        },
        {
            lookup: async () => [
                { address: "93.184.216.34", family: 4 },
            ],
            passwordResolver: () => "password",
            transportFactory: options => {
                capturedOptions = options;
                return {
                    verify: async () => true,
                    close: () => {
                        closed = true;
                    },
                };
            },
        }
    );

    assert.equal(capturedOptions.host, "93.184.216.34");
    assert.equal(capturedOptions.port, 587);
    assert.equal(capturedOptions.requireTLS, true);
    assert.equal(capturedOptions.tls.servername, "smtp.example.com");
    assert.equal(capturedOptions.connectionTimeout, 5_000);
    assert.equal(capturedOptions.socketTimeout, 10_000);
    assert.equal(closed, true);
});

test("verification rejects a disallowed port before DNS or transport creation", async () => {
    let lookupCalled = false;
    let transportCreated = false;

    await assert.rejects(
        verifyMerchantSmtp(
            {
                smtpHost: "smtp.example.com",
                smtpPort: 25,
                smtpUsername: "merchant@example.com",
                smtpPasswordEncrypted: "encrypted",
            },
            {
                lookup: async () => {
                    lookupCalled = true;
                    return [{ address: "93.184.216.34", family: 4 }];
                },
                passwordResolver: () => "password",
                transportFactory: () => {
                    transportCreated = true;
                    return {};
                },
            }
        ),
        error => error instanceof SmtpSecurityError &&
            error.code === "SMTP_PORT_REJECTED"
    );

    assert.equal(lookupCalled, false);
    assert.equal(transportCreated, false);
});

test("verification has a hard timeout and closes the transporter", async () => {
    let closed = false;

    await assert.rejects(
        verifyMerchantSmtp(
            {
                smtpHost: "smtp.example.com",
                smtpPort: 465,
                smtpSecure: true,
                smtpUsername: "merchant@example.com",
                smtpPasswordEncrypted: "encrypted",
            },
            {
                verificationTimeoutMs: 5,
                lookup: async () => [
                    { address: "93.184.216.34", family: 4 },
                ],
                passwordResolver: () => "password",
                transportFactory: () => ({
                    verify: () => new Promise(() => {}),
                    close: () => {
                        closed = true;
                    },
                }),
            }
        ),
        error => error instanceof SmtpSecurityError &&
            error.code === "SMTP_VERIFICATION_TIMEOUT"
    );

    assert.equal(closed, true);
});

test("enforces a per-shop verification rate limit", () => {
    const limiter = new SmtpVerificationLimiter({
        windowMs: 60_000,
        perShopLimit: 2,
        globalLimit: 10,
        maxConcurrent: 2,
    });

    limiter.acquire("shop-a", 1_000)();
    limiter.acquire("shop-a", 2_000)();

    assert.throws(
        () => limiter.acquire("shop-a", 3_000),
        error => error instanceof SmtpVerificationLimitError &&
            error.code === "SMTP_SHOP_RATE_LIMIT"
    );
});

test("enforces a global verification rate limit across shops", () => {
    const limiter = new SmtpVerificationLimiter({
        windowMs: 60_000,
        perShopLimit: 10,
        globalLimit: 2,
        maxConcurrent: 2,
    });

    limiter.acquire("shop-a", 1_000)();
    limiter.acquire("shop-b", 2_000)();

    assert.throws(
        () => limiter.acquire("shop-c", 3_000),
        error => error instanceof SmtpVerificationLimitError &&
            error.code === "SMTP_GLOBAL_RATE_LIMIT"
    );
});

test("enforces per-shop and global concurrency limits and releases slots", () => {
    const limiter = new SmtpVerificationLimiter({
        perShopLimit: 10,
        globalLimit: 10,
        maxConcurrent: 2,
        maxConcurrentPerShop: 1,
    });

    const releaseA = limiter.acquire("shop-a", 1_000);

    assert.throws(
        () => limiter.acquire("shop-a", 1_001),
        error => error instanceof SmtpVerificationLimitError &&
            error.code === "SMTP_CONCURRENCY_LIMIT"
    );

    const releaseB = limiter.acquire("shop-b", 1_002);

    assert.throws(
        () => limiter.acquire("shop-c", 1_003),
        error => error instanceof SmtpVerificationLimitError &&
            error.code === "SMTP_CONCURRENCY_LIMIT"
    );

    releaseA();
    const releaseC = limiter.acquire("shop-c", 1_004);

    releaseB();
    releaseC();
    assert.equal(limiter.activeGlobal, 0);
});
