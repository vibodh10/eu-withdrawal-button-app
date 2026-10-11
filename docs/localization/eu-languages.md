# EU withdrawal languages

## Language audit

The storefront already supported all 24 official EU languages: English (en),
German (de), French (fr), Italian (it), Spanish (es), Portuguese (pt), Dutch (nl),
Polish (pl), Danish (da), Swedish (sv), Finnish (fi), Czech (cs), Slovak (sk),
Slovenian (sl), Croatian (hr), Hungarian (hu), Romanian (ro), Bulgarian (bg),
Greek (el), Estonian (et), Latvian (lv), Lithuanian (lt), Irish (ga), and Maltese
(mt). No additional official EU language was missing. Regional locales are
variants of these languages rather than additional official EU languages;
existing base-language normalization, for example `fr-CA` to `fr`, is retained.
No specific requirement for distinct regional wording was identified.

Reference: [EU languages](https://european-union.europa.eu/principles-countries-history/languages_en).
The shared supported list is in `shared/euLanguages.js`.

The original 18 storefront keys were complete across the 24 locales and each
legal notice contained `{days}`. Gaps existed outside that dictionary: raw
English API errors, a duplicate-request message, the default launcher label,
close/selector/form accessibility labels, and browser-native validation text.
The audit also found inconsistent formality and withdrawal terminology in
several locales. Those terms were improved while preserving the notice's
qualification (“typically”) and configurable period. Translations do not add a
refund guarantee or change what submitting a request does.

## Storefront resources

Edit `storefront/withdrawal/locales/<code>.json` for language text and
`storefront/withdrawal/runtime.js` for the form's presentation. Resources contain
plain text, never HTML. Regenerate the shipping asset with:

```sh
node scripts/buildStorefrontTranslations.js
node scripts/buildStorefrontTranslations.js --check
node --test test/storefrontTranslations.test.js
```

The generated `extensions/eu-withdrawal-button/assets/withdrawal-button.js` is
committed. Both existing Liquid blocks still load that single classic deferred
script through Shopify's `asset_url`. No extra translation asset request,
module loader, external translation service, or script ordering dependency is
introduced. The dictionary is allocated once per script evaluation, shared by
both types of root, rather than recreated for every button. Existing root
initialization guards keep repeated block loads from creating duplicate forms.

Known app-proxy errors are mapped to translated presentation strings. Unknown
errors display the localized generic error instead of exposing raw server
text. Success references still use `textContent`. Only the displayed duplicate
message changes; endpoints, request payloads, status interpretation, resets,
and the existing close timer are preserved.

Merchant-entered launcher text remains unchanged. The stock launcher label is
translated; before settings load it uses the storefront locale, then follows
the selected form language. Merchant-enabled languages, default language,
settings-fetch failure behavior, and the language switch remain intact.

## Merchant admin

Additional application translations live beside the unchanged English and
German JSON files in `web/src/i18n/locales/`. Onboarding and the Settings app
language selector share the supported options. The two locale persistence
handlers use the same allowlist; their payload shapes, acceptance behavior,
and database fields are unchanged. Admin language choices do not modify the
merchant's enabled customer languages or their default.

The 22 newly added admin languages are Bulgarian, Croatian, Czech, Danish,
Dutch, Estonian, Finnish, French, Greek, Hungarian, Irish, Italian, Latvian,
Lithuanian, Maltese, Polish, Portuguese, Romanian, Slovak, Slovenian, Spanish,
and Swedish. They bring the admin's language coverage in line with the existing
24 official EU storefront languages. Each includes the complete English key
set and the language's required plural forms.

English and German remain bundled. Other application JSON resources load as
local Vite chunks on selection and are cached by i18next. Shopify-provided
Polaris component translations are used where available. For languages absent
from Polaris, its built-in component copy falls back to English; application
text uses the selected locale. The linked Data Processing Agreement remains
at its existing URL and is not rewritten by this localization work.

```sh
node --test test/adminLanguages.test.js test/storefrontTranslations.test.js
npm run build
npm test
npm exec --no -- shopify theme check --path extensions/eu-withdrawal-button
```

## Local Shopify review

Test both the page block and floating embed in a development store. Check the
onboarding and Settings language choice, persistence after reload, a merchant
custom launcher label, a regional storefront locale, enabled-language limits,
and each form language. Test required fields and malformed email addresses,
a successful request, duplicate requests, an invalid order, and an unavailable
connection. Review long labels on mobile and each translated legal notice.
The automated DOM boundary harness does not prove real browser layout,
native validation bubbles, or Shopify app-proxy integration.
