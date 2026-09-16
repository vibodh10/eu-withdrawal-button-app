import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOnce(content, from, to, label) {
  if (!content.includes(from)) {
    throw new Error(`Could not apply ${label}: source block not found`);
  }
  return content.replace(from, to);
}

function replaceRegexOnce(content, pattern, replacement, label) {
  if (!pattern.test(content)) {
    throw new Error(`Could not apply ${label}: source pattern not found`);
  }
  return content.replace(pattern, replacement);
}

// Settings UI: remove disabled template state, save settings atomically, and
// prevent secondary email actions from swallowing unrelated unsaved changes.
{
  const path = "web/src/pages/SettingsPage.jsx";
  let content = read(path);

  content = replaceOnce(
    content,
    '        resendFromEmail: shop?.resendFromEmail || "",\n        emailSubject: "",\n        emailBody: "",\n',
    '        resendFromEmail: shop?.resendFromEmail || "",\n',
    "obsolete email-template form fields"
  );

  content = replaceOnce(
    content,
    '        smtpPort: String(form.smtpPort ?? ""),\n        emailSubject: form.emailSubject || "",\n        emailBody: form.emailBody || "",\n',
    '        smtpPort: String(form.smtpPort ?? ""),\n',
    "obsolete email-template normalization"
  );

  content = replaceOnce(
    content,
    '    const [templateLoaded, setTemplateLoaded] = useState(false);\n',
    '    const templateLoaded = true;\n',
    "template loading state"
  );

  content = replaceRegexOnce(
    content,
    /    useEffect\(\(\) => \{\n        let cancelled = false;[\s\S]*?\n    \}, \[\]\);\n\n    useEffect\(\(\) => \{\n        if \(!boot\.isPro \|\| !boot\.shop\?\.resendDomainId\) return;/,
    '    useEffect(() => {\n        if (!boot.isPro || !boot.shop?.resendDomainId) return;',
    "disabled email-template loader"
  );

  const oldSave = `            await apiSend("/admin/settings", "PATCH", {\n                brandingName: form.brandingName,\n                locale: form.locale,\n                enabledLanguages: form.enabledLanguages,\n                brandingPrimaryColor: form.brandingPrimaryColor,\n                merchantNotification: form.merchantNotification,\n                legalPageUrl: form.legalPageUrl,\n                privacyPageUrl: form.privacyPageUrl,\n                supportEmail: form.supportEmail,\n                withdrawalDays: form.withdrawalDays,\n                emailDeliveryMethod: form.emailDeliveryMethod,\n            });\n\n            let savedSmtp = null;\n\n            if (boot.isPro) {\n                const smtpResponse = await apiSend("/admin/smtp", "PATCH", {\n                    smtpEnabled: form.emailDeliveryMethod === "SMTP",\n                    smtpHost: form.smtpHost,\n                    smtpPort: Number(form.smtpPort),\n                    smtpSecure: form.smtpSecure,\n                    smtpUsername: form.smtpUsername,\n                    smtpPassword: form.smtpPassword || undefined,\n                    smtpFromName: form.smtpFromName,\n                    smtpFromEmail: form.smtpFromEmail,\n                });\n                savedSmtp = smtpResponse.settings;\n            }\n`;
  const newSave = `            const response = await apiSend("/admin/settings/all", "PATCH", {\n                brandingName: form.brandingName,\n                locale: form.locale,\n                enabledLanguages: form.enabledLanguages,\n                brandingPrimaryColor: form.brandingPrimaryColor,\n                merchantNotification: form.merchantNotification,\n                legalPageUrl: form.legalPageUrl,\n                privacyPageUrl: form.privacyPageUrl,\n                supportEmail: form.supportEmail,\n                withdrawalDays: form.withdrawalDays,\n                emailDeliveryMethod: form.emailDeliveryMethod,\n                smtpEnabled: form.emailDeliveryMethod === "SMTP",\n                smtpHost: form.smtpHost,\n                smtpPort: Number(form.smtpPort),\n                smtpSecure: form.smtpSecure,\n                smtpUsername: form.smtpUsername,\n                smtpPassword: form.smtpPassword || undefined,\n                smtpFromName: form.smtpFromName,\n                smtpFromEmail: form.smtpFromEmail,\n            });\n\n            const savedSmtp = response.smtp || null;\n`;
  content = replaceOnce(content, oldSave, newSave, "atomic settings save");

  for (const functionName of ["disconnectSmtp", "createDomain", "saveDomainSender", "removeDomain"]) {
    const marker = `    async function ${functionName}() {\n`;
    const guard = `    async function ${functionName}() {\n        if (hasUnsavedChanges) {\n            setState((current) => ({\n                ...current,\n                error: "Save or discard your other settings changes first.",\n            }));\n            return;\n        }\n`;
    content = replaceOnce(content, marker, guard, `${functionName} dirty guard`);
  }

  content = replaceOnce(
    content,
    `    async function refreshDomain() {\n        try {\n`,
    `    async function refreshDomain() {\n        if (hasUnsavedChanges) {\n            setState((current) => ({\n                ...current,\n                error: "Save or discard your other settings changes before refreshing the domain.",\n            }));\n            return;\n        }\n\n        try {\n`,
    "refresh-domain dirty guard"
  );

  const refreshSetForm = `            setForm((current) => ({\n                ...current,\n                resendDomainName: settings.resendDomainName || current.resendDomainName,\n                resendFromName: settings.resendFromName || current.resendFromName,\n                resendFromEmail: settings.resendFromEmail || current.resendFromEmail,\n            }));\n`;
  const refreshReplacement = `            setForm((current) => {\n                const patch = {\n                    resendDomainName: settings.resendDomainName || current.resendDomainName,\n                    resendFromName: settings.resendFromName || current.resendFromName,\n                    resendFromEmail: settings.resendFromEmail || current.resendFromEmail,\n                };\n                savedFormRef.current = {\n                    ...savedFormRef.current,\n                    ...patch,\n                };\n                return {\n                    ...current,\n                    ...patch,\n                };\n            });\n`;
  content = replaceOnce(content, refreshSetForm, refreshReplacement, "refresh-domain saved baseline");

  write(path, content);
}

// Admin: cached entitlement fallback, exact SMTP passwords, and one atomic
// endpoint for the Settings form.
{
  const path = "src/routes/admin.js";
  let content = read(path);

  content = replaceOnce(
    content,
    `    } catch (error) {\n        console.error(\n            "Partner API billing reconciliation failed:",\n            error.message\n        );\n        return res.status(503).json({\n            error: "Could not verify Shopify App Pricing entitlement.",\n        });\n    }\n\n    return res.json({\n`,
    `    } catch (error) {\n        console.error(\n            "Partner API billing reconciliation failed:",\n            error.message\n        );\n\n        // A temporary Partner API outage must not take a merchant offline\n        // while the last verified entitlement is still within its freshness\n        // window. Stale/unverified billing state continues to fail closed.\n        if (hasAppEntitlement(req.shop)) {\n            shop = req.shop;\n        } else {\n            return res.status(503).json({\n                error: "Could not verify Shopify App Pricing entitlement.",\n            });\n        }\n    }\n\n    return res.json({\n`,
    "cached entitlement fallback"
  );

  content = replaceOnce(
    content,
    `    const password =\n        typeof smtpPassword === "string"\n            ? smtpPassword.trim()\n            : "";\n`,
    `    const password =\n        typeof smtpPassword === "string"\n            ? smtpPassword\n            : "";\n`,
    "exact SMTP password preservation"
  );

  const atomicRoute = `\n\n// PATCH /admin/settings/all\n// Validates and writes the Settings form in one database update so a failed\n// SMTP validation cannot leave general settings half-saved (or vice versa).\nadminRouter.patch("/settings/all", async (req, res) => {\n  try {\n    const shop = req.shop;\n    if (!shop) {\n      return res.status(401).json({ error: "Shop not found" });\n    }\n\n    const shopIsPro = isPro(shop);\n    const submittedLanguages = req.body.enabledLanguages !== undefined\n        ? req.body.enabledLanguages\n        : parseEnabledLanguages(shop.enabledLanguages);\n\n    if (!Array.isArray(submittedLanguages)) {\n      return res.status(400).json({\n        error: "enabledLanguages must be an array",\n      });\n    }\n\n    let enabledLanguages = [\n      ...new Set(\n        submittedLanguages\n          .map(normaliseLanguageCode)\n          .filter((code) => SUPPORTED_LANGUAGES.has(code))\n      ),\n    ];\n\n    if (enabledLanguages.length === 0) {\n      enabledLanguages = [...DEFAULT_ENABLED_LANGUAGES];\n    }\n\n    if (!shopIsPro) {\n      if (!enabledLanguages.includes("en")) enabledLanguages.unshift("en");\n      enabledLanguages = [...new Set(enabledLanguages)];\n      if (enabledLanguages.length > 2) {\n        return res.status(400).json({\n          error: "The Basic plan includes English plus 1 additional language.",\n        });\n      }\n    }\n\n    let locale = normaliseLanguageCode(req.body.locale ?? shop.locale ?? "en");\n    if (!SUPPORTED_LANGUAGES.has(locale) || !enabledLanguages.includes(locale)) {\n      locale = enabledLanguages.includes("en") ? "en" : enabledLanguages[0];\n    }\n\n    const requestedDeliveryMethod = ["GL6", "SMTP", "RESEND_DOMAIN"].includes(\n      req.body.emailDeliveryMethod\n    ) ? req.body.emailDeliveryMethod : "GL6";\n    const emailDeliveryMethod = shopIsPro ? requestedDeliveryMethod : "GL6";\n\n    const patch = {\n      brandingName: req.body.brandingName,\n      locale,\n      enabledLanguages: JSON.stringify(enabledLanguages),\n      merchantNotification: req.body.merchantNotification,\n      legalPageUrl: req.body.legalPageUrl,\n      privacyPageUrl: req.body.privacyPageUrl,\n      supportEmail: req.body.supportEmail,\n      emailDeliveryMethod,\n    };\n\n    if (shopIsPro) {\n      if (req.body.brandingPrimaryColor !== undefined) {\n        patch.brandingPrimaryColor = req.body.brandingPrimaryColor;\n      }\n\n      if (req.body.withdrawalDays !== undefined) {\n        const withdrawalDays = Number.parseInt(req.body.withdrawalDays, 10);\n        if (!Number.isInteger(withdrawalDays) || withdrawalDays < 1 || withdrawalDays > 365) {\n          return res.status(400).json({\n            error: "Withdrawal period must be between 1 and 365 days.",\n          });\n        }\n        patch.withdrawalDays = withdrawalDays;\n      }\n\n      const enabled = emailDeliveryMethod === "SMTP" && Boolean(req.body.smtpEnabled);\n      const host = String(req.body.smtpHost || "").trim();\n      const username = String(req.body.smtpUsername || "").trim();\n      const fromName = String(req.body.smtpFromName || "").trim();\n      const fromEmail = String(req.body.smtpFromEmail || "").trim();\n      const password = typeof req.body.smtpPassword === "string"\n          ? req.body.smtpPassword\n          : "";\n      const port = Number.parseInt(req.body.smtpPort, 10);\n\n      if (enabled) {\n        if (!host) return res.status(400).json({ error: "SMTP host is required." });\n        if (!isAllowedSmtpPort(port)) {\n          return res.status(400).json({\n            error: "SMTP verification is limited to ports 465 and 587.",\n          });\n        }\n        if (!username) return res.status(400).json({ error: "SMTP username is required." });\n        if (!fromEmail) return res.status(400).json({ error: "From email is required." });\n        if (!password && !shop.smtpPasswordEncrypted) {\n          return res.status(400).json({ error: "SMTP password is required." });\n        }\n      }\n\n      patch.smtpEnabled = enabled;\n      patch.smtpHost = host || null;\n      patch.smtpPort = Number.isInteger(port) ? port : null;\n      patch.smtpSecure = Boolean(req.body.smtpSecure);\n      patch.smtpUsername = username || null;\n      patch.smtpFromName = fromName || null;\n      patch.smtpFromEmail = fromEmail || null;\n      patch.smtpVerifiedAt = null;\n      patch.smtpLastError = null;\n      if (password) patch.smtpPasswordEncrypted = encryptSecret(password);\n    }\n\n    const cleaned = Object.fromEntries(\n      Object.entries(patch).filter(([, value]) => value !== undefined)\n    );\n\n    const updated = await prisma.shop.update({\n      where: { id: shop.id },\n      data: cleaned,\n    });\n\n    return res.json({\n      ok: true,\n      shop: {\n        ...publicShopView(updated),\n        ...publicSmtpSettings(updated),\n        ...publicResendDomainSettings(updated),\n      },\n      smtp: publicSmtpSettings(updated),\n    });\n  } catch (error) {\n    console.error("Update all settings failed:", error);\n    return res.status(500).json({\n      error: "Could not save settings.",\n    });\n  }\n});\n`;

  if (!content.includes('adminRouter.patch("/settings/all"')) {
    content += atomicRoute;
  }

  write(path, content);
}

// Storefront settings: Basic is English + one additional language, and the
// confirmation capability reflects the real server-side delivery switch.
{
  const path = "src/routes/proxy.js";
  let content = read(path);
  content = replaceOnce(
    content,
    "            // Free users: English plus up to three additional languages.\n",
    "            // Basic users: English plus one additional language.\n",
    "Basic language comment"
  );
  content = replaceOnce(
    content,
    "].slice(0, 4);",
    "].slice(0, 2);",
    "Basic language limit"
  );
  content = replaceOnce(
    content,
    `                /*\n                 * The form remains available, but no automatic\n                 * customer confirmation is currently sent.\n                 */\n                emailConfirmationsEnabled:\n                    false,\n`,
    `                emailConfirmationsEnabled:\n                    process.env.EMAIL_DELIVERY_ENABLED === "true",\n`,
    "confirmation capability flag"
  );
  write(path, content);
}

// Shopify integration: one API version, one scope source, one paid-handle
// source, and a real required-value identity assertion.
{
  const path = "src/lib/shopify.js";
  let content = read(path);
  content = replaceOnce(
    content,
    "const SHOPIFY_APP_HANDLE = process.env.SHOPIFY_APP_HANDLE || 'eu-withdrawal-button-2026';\n",
    "const SHOPIFY_APP_HANDLE = process.env.SHOPIFY_APP_HANDLE || 'eu-withdrawal-button-2026';\nconst SHOPIFY_ADMIN_API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || '2026-04';\n",
    "Admin API version constant"
  );
  content = replaceRegexOnce(
    content,
    /export function mapPlanHandleToAppPlan\(planHandle\) \{[\s\S]*?\n\}\n\nfunction normalizedPlanHandle/,
    `export function mapPlanHandleToAppPlan(planHandle) {\n  return isPaidPlanHandle(planHandle) ? "PRO" : "PAYMENT_REQUIRED";\n}\n\nfunction normalizedPlanHandle`,
    "paid plan single source"
  );
  content = replaceOnce(
    content,
    "`https://${normalizedShop}/admin/api/2026-01/graphql.json`",
    "`https://${normalizedShop}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`",
    "Admin GraphQL API version"
  );
  content = replaceOnce(
    content,
    '  assertIdentityValue(localShop?.id, localShop?.id, "Admin Shop ID is missing");\n',
    '  if (!localShop?.id) {\n    throw new Error("Shopify billing identity mismatch: Admin Shop ID is missing");\n  }\n',
    "Admin Shop ID presence assertion"
  );
  content = replaceOnce(
    content,
    `  scopes: ['read_orders'], // match your toml\n  hostName: process.env.APP_URL.replace(/https?:\\/\\//, ''),\n  apiVersion: "2024-10",\n`,
    `  scopes: String(\n      process.env.SHOPIFY_SCOPES ||\n      "read_orders,write_online_store_pages,write_app_proxy"\n  ).split(",").map((scope) => scope.trim()).filter(Boolean),\n  hostName: process.env.APP_URL.replace(/https?:\\/\\//, ''),\n  apiVersion: SHOPIFY_ADMIN_API_VERSION,\n`,
    "Shopify SDK scopes/version"
  );
  write(path, content);
}

// Do not attempt to navigate to an undefined URL on a generic 401.
{
  const path = "web/src/App.jsx";
  let content = read(path);
  content = replaceOnce(
    content,
    `            if (err.status === 401) {\n                window.open(err.data.redirectTo, "_top");\n                return;\n            }\n`,
    `            if (err.status === 401) {\n                const redirectTo = err.data?.redirectTo;\n                if (redirectTo && typeof redirectTo === "string") {\n                    window.open(redirectTo, "_top");\n                    return;\n                }\n            }\n`,
    "safe 401 redirect"
  );
  write(path, content);
}

// Confirmation email strings for every locale exposed in Settings.
{
  const path = "src/lib/email.js";
  let content = read(path);
  const start = content.indexOf("export function buildConfirmationEmail");
  if (start === -1) throw new Error("Could not find buildConfirmationEmail");
  content = content.slice(0, start) + `const CONFIRMATION_COPY = {\n  en: { subject: "Your withdrawal request has been received", received: "We have received your request.", reference: "Reference" },\n  de: { subject: "Ihre Widerrufsanfrage wurde erhalten", received: "Wir haben Ihre Anfrage erhalten.", reference: "Referenz" },\n  fr: { subject: "Votre demande de rétractation a été reçue", received: "Nous avons reçu votre demande.", reference: "Référence" },\n  it: { subject: "La tua richiesta di recesso è stata ricevuta", received: "Abbiamo ricevuto la tua richiesta.", reference: "Riferimento" },\n  es: { subject: "Hemos recibido tu solicitud de desistimiento", received: "Hemos recibido tu solicitud.", reference: "Referencia" },\n  pt: { subject: "O seu pedido de cancelamento foi recebido", received: "Recebemos o seu pedido.", reference: "Referência" },\n  nl: { subject: "Uw herroepingsverzoek is ontvangen", received: "We hebben uw verzoek ontvangen.", reference: "Referentie" },\n  pl: { subject: "Otrzymaliśmy Twoje zgłoszenie odstąpienia", received: "Otrzymaliśmy Twoje zgłoszenie.", reference: "Numer referencyjny" },\n  da: { subject: "Din anmodning om fortrydelse er modtaget", received: "Vi har modtaget din anmodning.", reference: "Reference" },\n  sv: { subject: "Din begäran om ångerrätt har tagits emot", received: "Vi har tagit emot din begäran.", reference: "Referens" },\n  fi: { subject: "Peruuttamispyyntösi on vastaanotettu", received: "Olemme vastaanottaneet pyyntösi.", reference: "Viite" },\n  cs: { subject: "Vaše žádost o odstoupení byla přijata", received: "Vaši žádost jsme přijali.", reference: "Reference" },\n  sk: { subject: "Vaša žiadosť o odstúpenie bola prijatá", received: "Vašu žiadosť sme prijali.", reference: "Referencia" },\n  sl: { subject: "Vaša zahteva za odstop je bila prejeta", received: "Prejeli smo vašo zahtevo.", reference: "Referenca" },\n  hr: { subject: "Vaš zahtjev za odustajanje je zaprimljen", received: "Zaprimili smo vaš zahtjev.", reference: "Referenca" },\n  hu: { subject: "Elállási kérelmét megkaptuk", received: "Megkaptuk a kérelmét.", reference: "Hivatkozás" },\n  ro: { subject: "Cererea dvs. de retragere a fost primită", received: "Am primit cererea dvs.", reference: "Referință" },\n  bg: { subject: "Вашето искане за отказ беше получено", received: "Получихме Вашето искане.", reference: "Референция" },\n  el: { subject: "Το αίτημα υπαναχώρησής σας ελήφθη", received: "Λάβαμε το αίτημά σας.", reference: "Αναφορά" },\n  et: { subject: "Teie taganemistaotlus on kätte saadud", received: "Oleme teie taotluse kätte saanud.", reference: "Viide" },\n  lv: { subject: "Jūsu atteikuma pieprasījums ir saņemts", received: "Mēs esam saņēmuši jūsu pieprasījumu.", reference: "Atsauce" },\n  lt: { subject: "Jūsų atsisakymo prašymas gautas", received: "Gavome jūsų prašymą.", reference: "Nuoroda" },\n  ga: { subject: "Fuarthas d’iarratas aistarraingthe", received: "Fuaireamar d’iarratas.", reference: "Tagairt" },\n  mt: { subject: "It-talba tiegħek għall-irtirar waslet", received: "Irċevejna t-talba tiegħek.", reference: "Referenza" },\n};\n\nexport function buildConfirmationEmail({\n  shopName,\n  reference,\n  locale = "en",\n}) {\n  const language = String(locale || "en").toLowerCase().split("-")[0];\n  const copy = CONFIRMATION_COPY[language] || CONFIRMATION_COPY.en;\n\n  return {\n    subject: copy.subject,\n    html: \`<div><p>\${copy.received}</p><p>\${copy.reference}: <strong>\${reference}</strong></p></div>\`,\n  };\n}\n`;
  write(path, content);
}

console.log("Applied repository audit fixes.");
