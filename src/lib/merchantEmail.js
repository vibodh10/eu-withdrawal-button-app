import nodemailer from "nodemailer";

import {
    decryptSecret,
} from "./encryption.js";

import {
    sendEmail as sendGl6Email,
} from "./email.js";

function buildMerchantTransport(shop) {
    if (
        !shop.smtpHost ||
        !shop.smtpPort ||
        !shop.smtpUsername ||
        !shop.smtpPasswordEncrypted
    ) {
        throw new Error(
            "SMTP settings are incomplete"
        );
    }

    const port = Number(shop.smtpPort);

    return nodemailer.createTransport({
        host: shop.smtpHost,
        port,

        /*
         * true is normally used for implicit TLS
         * on port 465.
         *
         * false is normally used for port 587,
         * where STARTTLS upgrades the connection.
         */
        secure: Boolean(shop.smtpSecure),

        auth: {
            user: shop.smtpUsername,
            pass: decryptSecret(
                shop.smtpPasswordEncrypted
            ),
        },

        requireTLS:
            !shop.smtpSecure &&
            port === 587,

        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
    });
}

export async function verifyMerchantSmtp(
    shop
) {
    const transporter =
        buildMerchantTransport(shop);

    await transporter.verify();

    return true;
}

export async function sendCustomerConfirmation({
                                                   shop,
                                                   to,
                                                   subject,
                                                   html,
                                               }) {
    const merchantName =
        shop.brandingName ||
        shop.shopDomain ||
        "Withdrawal Requests";

    const merchantReplyTo =
        shop.supportEmail ||
        shop.merchantNotification ||
        process.env.FROM_EMAIL;

    const shouldUseMerchantSmtp =
        shop.plan === "PRO" &&
        shop.smtpEnabled &&
        shop.smtpVerifiedAt;

    if (shouldUseMerchantSmtp) {
        try {
            const transporter =
                buildMerchantTransport(shop);

            const fromEmail =
                shop.smtpFromEmail ||
                shop.smtpUsername;

            const fromName =
                shop.smtpFromName ||
                merchantName;

            return await transporter.sendMail({
                from: `"${fromName}" <${fromEmail}>`,
                to,
                subject,
                html,
                replyTo: merchantReplyTo,
            });
        } catch (error) {
            console.error(
                "Merchant SMTP delivery failed:",
                {
                    shop:
                    shop.shopDomain,
                    message:
                    error.message,
                }
            );

            /*
             * Do not fail the withdrawal request.
             * Continue to GL6 fallback.
             */
        }
    }

    return sendGl6Email({
        to,
        subject,
        html,
        from:
            `${merchantName} via GL6 ` +
            `<${process.env.FROM_EMAIL}>`,

        replyTo:
            shop.supportEmail ||
            shop.merchantNotification ||
            process.env.FROM_EMAIL,
    });
}