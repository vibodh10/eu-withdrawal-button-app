import { Resend } from "resend";
import {
    EmailDeliveryDisabledError,
    guardedEmailDelivery,
} from "./emailDeliveryGuard.js";
import {
    abuseProtection,
    executeProtectedEmail,
} from "./abuseProtection.js";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail({
                                    to,
                                    subject,
                                    html,
                                    from = process.env.FROM_EMAIL,
                                    replyTo,
                                }, {
                                    resendClient = resend,
                                    protection = abuseProtection,
                                    deliveryContext = {},
                                } = {}) {
    try {
        const data =
            await executeProtectedEmail({
                shopDomain: deliveryContext.shopDomain,
                recipient: to,
                provider: "GL6_RESEND",
                withdrawalRequestId:
                    deliveryContext.withdrawalRequestId,
                protection,
                deliveryOperation: async () => {
                    const { data, error } =
                        await guardedEmailDelivery(
                            () => resendClient.emails.send({
                            from,
                            to,
                            subject,
                            html,
                            ...(replyTo ? { replyTo } : {}),
                            })
                        );
                    if (error) {
                        throw new Error(
                            error.message || "Email delivery failed"
                        );
                    }
                    return data;
                },
            });

        console.log("Email sent", {
            providerId: data?.id ?? null,
        });

        return data;
    } catch (error) {
        if (error instanceof EmailDeliveryDisabledError) {
            throw error;
        }

        console.error("Email failed:", error);
        throw error;
    }
}

export function buildConfirmationEmail({
                                         shopName,
                                         reference,
                                         locale = "en",
                                       }) {
  const subject =
      locale === "de"
          ? "Ihre Widerrufsanfrage wurde erhalten"
          : "Your withdrawal request has been received";

  const html =
      locale === "de"
          ? `
          <p>Wir haben Ihre Anfrage erhalten.</p>
          <p>Referenz: <strong>${reference}</strong></p>
        `
          : `
          <p>We have received your request.</p>
          <p>Reference: <strong>${reference}</strong></p>
        `;

  return {
    subject,
    html: `<div>${html}</div>`,
  };
}
