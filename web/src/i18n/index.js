import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import de from "./locales/de.json";

import { EU_LANGUAGE_CODES, normalizeEuLanguage } from "../../../shared/euLanguages.js";

export const SUPPORTED_ADMIN_LANGUAGES = EU_LANGUAGE_CODES;

export const normalizeAdminLanguage = normalizeEuLanguage;

// Vite builds local language chunks; only the selected additional locale loads.
// English and German stay bundled exactly as before.
const localeModules = import.meta.glob("./locales/*.json", { import: "default" });
const localBackend = {
    type: "backend",
    read(language, namespace, callback) {
        const load = localeModules[`./locales/${language}.json`];
        if (!load) return callback(new Error(`Unsupported app language: ${language}`), false);
        load().then((resource) => callback(null, resource), (error) => callback(error, false));
    },
};

i18n.use(localBackend).use(initReactI18next).init({
    resources: {
        en: { translation: en },
        de: { translation: de },
    },
    partialBundledLanguages: true,

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