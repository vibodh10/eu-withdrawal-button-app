// The EU's 24 official languages. Regional storefront locales use their base code.
export const EU_LANGUAGE_OPTIONS = [
    ['en', 'English'], ['de', 'Deutsch'], ['fr', 'Français'], ['it', 'Italiano'],
    ['es', 'Español'], ['pt', 'Português'], ['nl', 'Nederlands'], ['pl', 'Polski'],
    ['da', 'Dansk'], ['sv', 'Svenska'], ['fi', 'Suomi'], ['cs', 'Čeština'],
    ['sk', 'Slovenčina'], ['sl', 'Slovenščina'], ['hr', 'Hrvatski'], ['hu', 'Magyar'],
    ['ro', 'Română'], ['bg', 'Български'], ['el', 'Ελληνικά'], ['et', 'Eesti'],
    ['lv', 'Latviešu'], ['lt', 'Lietuvių'], ['ga', 'Gaeilge'], ['mt', 'Malti'],
].map(([value, label]) => ({ value, label }));

export const EU_LANGUAGE_CODES = EU_LANGUAGE_OPTIONS.map(({ value }) => value);

export function normalizeEuLanguage(value) {
    const language = String(value || 'en').trim().toLowerCase().split('-')[0];
    return EU_LANGUAGE_CODES.includes(language) ? language : 'en';
}
