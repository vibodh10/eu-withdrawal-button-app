import dns from "node:dns/promises";
import net from "node:net";

export const SAFE_SMTP_PORTS = Object.freeze([465, 587]);

const SAFE_SMTP_PORT_SET = new Set(SAFE_SMTP_PORTS);

const IPV4_DENY_RANGES = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["168.63.129.16", 32],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.31.196.0", 24],
    ["192.52.193.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["192.175.48.0", 24],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
];

const IPV6_DENY_RANGES = [
    ["::", 96],
    ["64:ff9b::", 96],
    ["64:ff9b:1::", 48],
    ["100::", 64],
    ["2001::", 23],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["3fff::", 20],
    ["fc00::", 7],
    ["fe80::", 10],
    ["fec0::", 10],
    ["ff00::", 8],
];

function ipv4ToBigInt(address) {
    const parts = String(address).split(".");

    if (parts.length !== 4) {
        throw new Error("Invalid IPv4 address");
    }

    return parts.reduce((result, part) => {
        const value = Number(part);

        if (!Number.isInteger(value) || value < 0 || value > 255) {
            throw new Error("Invalid IPv4 address");
        }

        return (result << 8n) | BigInt(value);
    }, 0n);
}

function ipv6ToBigInt(address) {
    let value = String(address).toLowerCase();

    if (value.includes("%")) {
        throw new Error("Scoped IPv6 addresses are not allowed");
    }

    if (value.includes(".")) {
        const lastColon = value.lastIndexOf(":");
        const ipv4 = ipv4ToBigInt(value.slice(lastColon + 1));
        const high = Number((ipv4 >> 16n) & 0xffffn).toString(16);
        const low = Number(ipv4 & 0xffffn).toString(16);
        value = `${value.slice(0, lastColon)}:${high}:${low}`;
    }

    const halves = value.split("::");

    if (halves.length > 2) {
        throw new Error("Invalid IPv6 address");
    }

    const left = halves[0] ? halves[0].split(":") : [];
    const right = halves[1] ? halves[1].split(":") : [];
    const missing = 8 - left.length - right.length;

    if (
        (halves.length === 1 && missing !== 0) ||
        (halves.length === 2 && missing < 1)
    ) {
        throw new Error("Invalid IPv6 address");
    }

    const parts = [
        ...left,
        ...Array(missing).fill("0"),
        ...right,
    ];

    return parts.reduce((result, part) => {
        if (!/^[0-9a-f]{1,4}$/.test(part)) {
            throw new Error("Invalid IPv6 address");
        }

        return (result << 16n) | BigInt(`0x${part}`);
    }, 0n);
}

function cidrContains(address, rangeAddress, prefix, bits, parser) {
    const addressValue = parser(address);
    const rangeValue = parser(rangeAddress);
    const shift = BigInt(bits - prefix);

    return (addressValue >> shift) === (rangeValue >> shift);
}

export function isPublicIpAddress(address) {
    const family = net.isIP(address);

    if (family === 4) {
        return !IPV4_DENY_RANGES.some(([range, prefix]) =>
            cidrContains(address, range, prefix, 32, ipv4ToBigInt)
        );
    }

    if (family === 6) {
        const value = ipv6ToBigInt(address);
        const mappedPrefix = ipv6ToBigInt("::ffff:0:0");

        if ((value >> 32n) === (mappedPrefix >> 32n)) {
            const ipv4Value = value & 0xffffffffn;
            const mappedIpv4 = [24n, 16n, 8n, 0n]
                .map(shift => Number((ipv4Value >> shift) & 0xffn))
                .join(".");

            return isPublicIpAddress(mappedIpv4);
        }

        const isGlobalUnicast = cidrContains(
            address,
            "2000::",
            3,
            128,
            ipv6ToBigInt
        );

        return isGlobalUnicast && !IPV6_DENY_RANGES.some(
            ([range, prefix]) =>
                cidrContains(address, range, prefix, 128, ipv6ToBigInt)
        );
    }

    return false;
}

export function isAllowedSmtpPort(value) {
    const port = Number(value);
    return Number.isInteger(port) && SAFE_SMTP_PORT_SET.has(port);
}

function normalizeSmtpHost(value) {
    let host = String(value || "").trim().toLowerCase();

    if (host.startsWith("[") && host.endsWith("]")) {
        host = host.slice(1, -1);
    }

    host = host.replace(/\.$/, "");

    if (!host || host.length > 253 || /[\s/@?#\\]/.test(host)) {
        throw new SmtpSecurityError(
            "SMTP_DESTINATION_REJECTED",
            "SMTP host is invalid."
        );
    }

    if (!net.isIP(host)) {
        const labels = host.split(".");

        if (
            labels.length < 2 ||
            labels.some(label =>
                !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
            )
        ) {
            throw new SmtpSecurityError(
                "SMTP_DESTINATION_REJECTED",
                "SMTP host is invalid."
            );
        }
    }

    return host;
}

async function systemLookup(host) {
    return dns.lookup(host, {
        all: true,
        verbatim: true,
    });
}

export class SmtpSecurityError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "SmtpSecurityError";
        this.code = code;
    }
}

export async function resolvePublicSmtpDestination(
    hostValue,
    { lookup = systemLookup } = {}
) {
    const host = normalizeSmtpHost(hostValue);
    const literalFamily = net.isIP(host);
    const resolved = literalFamily
        ? [{ address: host, family: literalFamily }]
        : await lookup(host);

    const addresses = [...new Set(
        (Array.isArray(resolved) ? resolved : [resolved])
            .map(item => typeof item === "string" ? item : item?.address)
            .filter(Boolean)
    )];

    if (
        addresses.length === 0 ||
        addresses.some(address => !isPublicIpAddress(address))
    ) {
        throw new SmtpSecurityError(
            "SMTP_DESTINATION_REJECTED",
            "SMTP host must resolve only to public IP addresses."
        );
    }

    return {
        host,
        address: addresses[0],
        addresses,
        servername: literalFamily ? null : host,
    };
}

export class SmtpVerificationLimitError extends Error {
    constructor(code, message, retryAfterSeconds = 1) {
        super(message);
        this.name = "SmtpVerificationLimitError";
        this.code = code;
        this.statusCode = 429;
        this.retryAfterSeconds = Math.max(1, retryAfterSeconds);
    }
}

export class SmtpVerificationLimiter {
    constructor({
                    windowMs = 15 * 60 * 1000,
                    perShopLimit = 5,
                    globalLimit = 50,
                    maxConcurrent = 3,
                    maxConcurrentPerShop = 1,
                } = {}) {
        this.windowMs = windowMs;
        this.perShopLimit = perShopLimit;
        this.globalLimit = globalLimit;
        this.maxConcurrent = maxConcurrent;
        this.maxConcurrentPerShop = maxConcurrentPerShop;
        this.globalAttempts = [];
        this.shopAttempts = new Map();
        this.activeGlobal = 0;
        this.activeByShop = new Map();
    }

    acquire(shopId, now = Date.now()) {
        const key = String(shopId || "");

        if (!key) {
            throw new Error("shopId is required for SMTP verification");
        }

        const threshold = now - this.windowMs;
        this.globalAttempts = this.globalAttempts.filter(
            timestamp => timestamp > threshold
        );

        for (const [existingKey, attempts] of this.shopAttempts) {
            const current = attempts.filter(timestamp => timestamp > threshold);

            if (current.length) {
                this.shopAttempts.set(existingKey, current);
            } else {
                this.shopAttempts.delete(existingKey);
            }
        }

        const shopAttempts = this.shopAttempts.get(key) || [];

        if (shopAttempts.length >= this.perShopLimit) {
            const retryAfter = Math.ceil(
                (shopAttempts[0] + this.windowMs - now) / 1000
            );

            throw new SmtpVerificationLimitError(
                "SMTP_SHOP_RATE_LIMIT",
                "Too many SMTP verification attempts for this shop.",
                retryAfter
            );
        }

        if (this.globalAttempts.length >= this.globalLimit) {
            const retryAfter = Math.ceil(
                (this.globalAttempts[0] + this.windowMs - now) / 1000
            );

            throw new SmtpVerificationLimitError(
                "SMTP_GLOBAL_RATE_LIMIT",
                "SMTP verification is temporarily busy.",
                retryAfter
            );
        }

        if (
            this.activeGlobal >= this.maxConcurrent ||
            (this.activeByShop.get(key) || 0) >= this.maxConcurrentPerShop
        ) {
            throw new SmtpVerificationLimitError(
                "SMTP_CONCURRENCY_LIMIT",
                "SMTP verification is already in progress.",
                1
            );
        }

        shopAttempts.push(now);
        this.shopAttempts.set(key, shopAttempts);
        this.globalAttempts.push(now);
        this.activeGlobal += 1;
        this.activeByShop.set(key, (this.activeByShop.get(key) || 0) + 1);

        let released = false;

        return () => {
            if (released) return;
            released = true;
            this.activeGlobal = Math.max(0, this.activeGlobal - 1);

            const activeForShop = (this.activeByShop.get(key) || 1) - 1;

            if (activeForShop > 0) {
                this.activeByShop.set(key, activeForShop);
            } else {
                this.activeByShop.delete(key);
            }
        };
    }
}

export const smtpVerificationLimiter = new SmtpVerificationLimiter();
