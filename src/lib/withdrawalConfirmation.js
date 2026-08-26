import { buildConfirmationEmail } from "./email.js";
import { sendCustomerConfirmation } from "./merchantEmail.js";

function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
}

export async function sendVerifiedWithdrawalConfirmation({
    shop,
    withdrawalRequest,
    verifiedOrderEmail,
}, {
    sendConfirmation = sendCustomerConfirmation,
    sendOptions,
} = {}) {
    const recipient = normalizeEmail(verifiedOrderEmail);
    const persistedRecipient = normalizeEmail(
        withdrawalRequest?.customerEmail
    );

    if (
        !shop?.shopDomain ||
        !withdrawalRequest?.id ||
        !withdrawalRequest?.publicReference ||
        !["VERIFIED", "EXPIRED"].includes(
            withdrawalRequest?.verificationStatus
        ) ||
        !recipient ||
        recipient !== persistedRecipient
    ) {
        const error = new Error(
            "Verified withdrawal confirmation context is invalid."
        );
        error.code = "WITHDRAWAL_CONFIRMATION_CONTEXT_INVALID";
        throw error;
    }

    const { subject, html } = buildConfirmationEmail({
        shopName: shop.brandingName || shop.shopDomain,
        reference: withdrawalRequest.publicReference,
        locale: withdrawalRequest.locale || shop.locale || "en",
    });

    return sendConfirmation({
        shop,
        to: recipient,
        subject,
        html,
        withdrawalRequestId: withdrawalRequest.id,
    }, sendOptions);
}
