export class AbuseProtectionError extends Error {
    constructor(code, message, {
        retryAfterSeconds = 60,
        scope = null,
    } = {}) {
        super(message);
        this.name = "AbuseProtectionError";
        this.code = code;
        this.retryAfterSeconds = retryAfterSeconds;
        this.scope = scope;
    }
}

export function isAbuseProtectionError(error) {
    return error instanceof AbuseProtectionError;
}
