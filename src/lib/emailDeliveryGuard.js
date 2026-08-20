const ENABLED_VALUE = "true";

export class EmailDeliveryDisabledError extends Error {
    constructor() {
        super("Email delivery is disabled.");
        this.name = "EmailDeliveryDisabledError";
        this.code = "EMAIL_DELIVERY_DISABLED";
    }
}

export function isEmailDeliveryEnabled() {
    try {
        // Deliberately exact: missing values, alternate casing, whitespace,
        // and other truthy strings all fail closed.
        return process.env.EMAIL_DELIVERY_ENABLED === ENABLED_VALUE;
    } catch {
        return false;
    }
}

export function assertEmailDeliveryEnabled() {
    if (!isEmailDeliveryEnabled()) {
        throw new EmailDeliveryDisabledError();
    }
}

export async function guardedEmailDelivery(
    deliveryOperation
) {
    assertEmailDeliveryEnabled();
    return deliveryOperation();
}
