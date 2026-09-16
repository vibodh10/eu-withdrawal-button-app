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

const CONFIRMATION_COPY = Object.freeze({
    en: { subject: "Your withdrawal request has been received", received: "We have received your request.", reference: "Reference" },
    de: { subject: "Ihre Widerrufsanfrage wurde erhalten", received: "Wir haben Ihre Anfrage erhalten.", reference: "Referenz" },
    fr: { subject: "Votre demande de rétractation a été reçue", received: "Nous avons reçu votre demande.", reference: "Référence" },
    it: { subject: "La tua richiesta di recesso è stata ricevuta", received: "Abbiamo ricevuto la tua richiesta.", reference: "Riferimento" },
    es: { subject: "Hemos recibido tu solicitud de desistimiento", received: "Hemos recibido tu solicitud.", reference: "Referencia" },
    pt: { subject: "O seu pedido de desistência foi recebido", received: "Recebemos o seu pedido.", reference: "Referência" },
    nl: { subject: "Uw herroepingsverzoek is ontvangen", received: "We hebben uw verzoek ontvangen.", reference: "Referentie" },
    pl: { subject: "Otrzymaliśmy Twoje żądanie odstąpienia", received: "Otrzymaliśmy Twoje żądanie.", reference: "Numer referencyjny" },
    da: { subject: "Din anmodning om fortrydelse er modtaget", received: "Vi har modtaget din anmodning.", reference: "Reference" },
    sv: { subject: "Din begäran om ångerrätt har tagits emot", received: "Vi har tagit emot din begäran.", reference: "Referens" },
    fi: { subject: "Peruuttamispyyntösi on vastaanotettu", received: "Olemme vastaanottaneet pyyntösi.", reference: "Viite" },
    cs: { subject: "Vaše žádost o odstoupení byla přijata", received: "Vaši žádost jsme přijali.", reference: "Reference" },
    sk: { subject: "Vaša žiadosť o odstúpenie bola prijatá", received: "Vašu žiadosť sme prijali.", reference: "Referencia" },
    sl: { subject: "Vaša zahteva za odstop je bila prejeta", received: "Prejeli smo vašo zahtevo.", reference: "Referenca" },
    hr: { subject: "Vaš zahtjev za odustajanje je zaprimljen", received: "Zaprimili smo vaš zahtjev.", reference: "Referenca" },
    hu: { subject: "Elállási kérelmét megkaptuk", received: "Megkaptuk a kérelmét.", reference: "Hivatkozás" },
    ro: { subject: "Cererea dvs. de retragere a fost primită", received: "Am primit cererea dvs.", reference: "Referință" },
    bg: { subject: "Вашето искане за отказ е получено", received: "Получихме Вашето искане.", reference: "Референция" },
    el: { subject: "Το αίτημα υπαναχώρησής σας ελήφθη", received: "Λάβαμε το αίτημά σας.", reference: "Αναφορά" },
    et: { subject: "Teie taganemistaotlus on vastu võetud", received: "Oleme teie taotluse kätte saanud.", reference: "Viide" },
    lv: { subject: "Jūsu atteikuma pieprasījums ir saņemts", received: "Mēs esam saņēmuši jūsu pieprasījumu.", reference: "Atsauce" },
    lt: { subject: "Jūsų atsisakymo prašymas gautas", received: "Gavome jūsų prašymą.", reference: "Nuoroda" },
    ga: { subject: "Fuarthas d’iarratas aistarraingthe", received: "Fuaireamar d’iarratas.", reference: "Tagairt" },
    mt: { subject: "It-talba tiegħek għall-irtirar waslet", received: "Irċevejna t-talba tiegħek.", reference: "Referenza" },
});

export function buildConfirmationEmail({
                                         shopName,
                                         reference,
                                         locale = "en",
                                       }) {
    const language = String(locale || "en")
        .trim()
        .toLowerCase()
        .split("-")[0];
    const copy = CONFIRMATION_COPY[language] || CONFIRMATION_COPY.en;

    return {
        subject: copy.subject,
        html: `<div>
          <p>${copy.received}</p>
          <p>${copy.reference}: <strong>${reference}</strong></p>
        </div>`,
    };
}
