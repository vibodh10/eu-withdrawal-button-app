import nodemailer from "nodemailer";
import { Resend } from "resend";

import { decryptSecret } from "./encryption.js";
import { sendEmail as sendGl6Email } from "./email.js";
import {
    isAllowedSmtpPort,
    resolvePublicSmtpDestination,
    SmtpSecurityError,
} from "./smtpSecurity.js";
import {
    assertEmailDeliveryEnabled,
    EmailDeliveryDisabledError,
    guardedEmailDelivery,
} from "./emailDeliveryGuard.js";

const resend = new Resend(process.env.RESEND_API_KEY);

async function buildMerchantTransport(
    shop,
    {
        lookup,
        transportFactory = nodemailer.createTransport,
        passwordResolver = decryptSecret,
    } = {}
) {
    if (
        !shop.smtpHost ||
        !shop.smtpPort ||
        !shop.smtpUsername ||
        !shop.smtpPasswordEncrypted
    ) {
        throw new Error("SMTP settings are incomplete");
    }

    const port = Number(shop.smtpPort);

    if (!isAllowedSmtpPort(port)) {
        throw new SmtpSecurityError(
            "SMTP_PORT_REJECTED",
            "SMTP port is not allowed."
        );
    }

    const destination =
        await resolvePublicSmtpDestination(
            shop.smtpHost,
            lookup ? { lookup } : undefined
        );

    const transportOptions = {
        // Connect to the already-resolved and validated address so a
        // second DNS lookup cannot redirect the socket internally.
        host: destination.address,
        port,
        secure: Boolean(shop.smtpSecure),

        auth: {
            user: shop.smtpUsername,
            pass: passwordResolver(
                shop.smtpPasswordEncrypted
            ),
        },

        requireTLS:
            !shop.smtpSecure &&
            port === 587,

        connectionTimeout: 5_000,
        greetingTimeout: 5_000,
        socketTimeout: 10_000,
    };

    if (destination.servername) {
        transportOptions.tls = {
            // Preserve certificate hostname validation while connecting
            // directly to the pinned public IP address.
            servername: destination.servername,
        };
    }

    return transportFactory(transportOptions);
}

export async function verifyMerchantSmtp(
    shop,
    {
        verificationTimeoutMs = 10_000,
        ...transportOptions
    } = {}
) {
    const transporter =
        await buildMerchantTransport(
            shop,
            transportOptions
        );

    let timeout;

    try {
        await Promise.race([
            transporter.verify(),
            new Promise((_, reject) => {
                timeout = setTimeout(() => {
                    reject(
                        new SmtpSecurityError(
                            "SMTP_VERIFICATION_TIMEOUT",
                            "SMTP verification timed out."
                        )
                    );
                }, verificationTimeoutMs);

                timeout.unref?.();
            }),
        ]);
    } finally {
        clearTimeout(timeout);
        transporter.close?.();
    }

    return true;
}

export async function sendCustomerConfirmation({
                                                   shop,
                                                   to,
                                                   subject,
                                                   html,
                                               }, {
                                                   resendClient = resend,
                                                   smtpTransportOptions,
                                               } = {}) {
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
                await guardedEmailDelivery(
                    () => resendClient.emails.send({
                        from:
                            `${fromName} ` +
                            `<${shop.resendFromEmail}>`,
                        to,
                        subject,
                        html,
                        replyTo:
                        merchantReplyTo,
                    })
                );

            if (error) {
                throw new Error(
                    error.message ||
                    "Verified-domain email failed"
                );
            }

            return data;
        } catch (error) {
            if (error instanceof EmailDeliveryDisabledError) {
                throw error;
            }

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
            // Avoid DNS and transport preparation while disabled. The guard
            // is checked again immediately before sendMail because the switch
            // can change while a queued/retried operation is preparing.
            assertEmailDeliveryEnabled();

            const transporter =
                await buildMerchantTransport(
                    shop,
                    smtpTransportOptions
                );

            const fromEmail =
                shop.smtpFromEmail ||
                shop.smtpUsername;

            const fromName =
                shop.smtpFromName ||
                merchantName;

            return await guardedEmailDelivery(
                () => transporter.sendMail({
                    from:
                        `"${fromName}" <${fromEmail}>`,
                    to,
                    subject,
                    html,
                    replyTo:
                    merchantReplyTo,
                })
            );
        } catch (error) {
            if (error instanceof EmailDeliveryDisabledError) {
                throw error;
            }

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
    // return sendGl6Email({
    //     to,
    //     subject,
    //     html,
    //     from:
    //         `${merchantName} via GL6 ` +
    //         `<${process.env.FROM_EMAIL}>`,
    //     replyTo:
    //     merchantReplyTo,
    // });

    throw new Error(
        "Merchant email delivery is unavailable."
    );
}
