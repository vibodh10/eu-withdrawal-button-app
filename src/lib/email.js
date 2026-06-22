import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail({
                                    to,
                                    subject,
                                    html,
                                    from = process.env.FROM_EMAIL,
                                    replyTo,
                                }) {
    try {
        const { data, error } = await resend.emails.send({
            from,
            to,
            subject,
            html,
            ...(replyTo ? { replyTo } : {}),
        });

        if (error) {
            throw new Error(
                error.message || "Email delivery failed"
            );
        }

        console.log("Email sent:", data);

        return data;
    } catch (error) {
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