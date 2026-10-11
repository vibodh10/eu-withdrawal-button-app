import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import de from "./locales/de.json";

export const SUPPORTED_ADMIN_LANGUAGES = ["en", "de"];

export function normalizeAdminLanguage(value) {
    const language = String(value || "en")
        .trim()
        .toLowerCase()
        .split("-")[0];

    return SUPPORTED_ADMIN_LANGUAGES.includes(language)
        ? language
        : "en";
}

i18n.use(initReactI18next).init({
    resources: {
        en: { translation: en },
        de: { translation: de },
    },

    lng: "en",
    fallbackLng: "en",
    supportedLngs: SUPPORTED_ADMIN_LANGUAGES,

    interpolation: {
        escapeValue: false,
    },

    react: {
        useSuspense: false,
    },
});

export default i18n;