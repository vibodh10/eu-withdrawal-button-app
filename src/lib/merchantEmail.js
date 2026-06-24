import nodemailer from "nodemailer";
import { Resend } from "resend";

import { decryptSecret } from "./encryption.js";
import { sendEmail as sendGl6Email } from "./email.js";

const resend = new Resend(process.env.RESEND_API_KEY);

function buildMerchantTransport(shop) {
    if (
        !shop.smtpHost ||
        !shop.smtpPort ||
        !shop.smtpUsername ||
        !shop.smtpPasswordEncrypted
    ) {
        throw new Error("SMTP settings are incomplete");
    }

    const port = Number(shop.smtpPort);

    return nodemailer.createTransport({
        host: shop.smtpHost,
        port,
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

export async function verifyMerchantSmtp(shop) {
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

    /*
     * Option 1:
     * Pro merchant with a verified Resend domain.
     */
    if (
        shop.plan === "PRO" &&
        shop.emailDeliveryMethod ===
        "RESEND_DOMAIN" &&
        shop.resendDomainStatus ===
        "verified" &&
        shop.resendFromEmail
    ) {
        try {
            const fromName =
                shop.resendFromName ||
                merchantName;

            const { data, error } =
                await resend.emails.send({
                    from:
                        `${fromName} ` +
                        `<${shop.resendFromEmail}>`,
                    to,
                    subject,
                    html,
                    replyTo:
                    merchantReplyTo,
                });

            if (error) {
                throw new Error(
                    error.message ||
                    "Verified-domain email failed"
                );
            }

            return data;
        } catch (error) {
            console.error(
                "Verified Resend-domain delivery failed:",
                {
                    shop: shop.shopDomain,
                    message: error.message,
                }
            );

            /*
             * Continue to GL6 fallback.
             */
        }
    }

    /*
     * Option 2:
     * Pro merchant with connected SMTP.
     */
    if (
        shop.plan === "PRO" &&
        shop.emailDeliveryMethod === "SMTP" &&
        shop.smtpEnabled &&
        shop.smtpVerifiedAt
    ) {
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
                from:
                    `"${fromName}" <${fromEmail}>`,
                to,
                subject,
                html,
                replyTo:
                merchantReplyTo,
            });
        } catch (error) {
            console.error(
                "Merchant SMTP delivery failed:",
                {
                    shop: shop.shopDomain,
                    message: error.message,
                }
            );

            /*
             * Continue to GL6 fallback.
             */
        }
    }

    /*
     * Option 3:
     * Basic, unconfigured Pro,
     * or fallback after failure.
     */
    return sendGl6Email({
        to,
        subject,
        html,
        from:
            `${merchantName} via GL6 ` +
            `<${process.env.FROM_EMAIL}>`,
        replyTo:
        merchantReplyTo,
    });
}