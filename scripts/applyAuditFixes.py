from pathlib import Path
import re


def read(path):
    return Path(path).read_text()


def write(path, text):
    Path(path).write_text(text)


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def regex_once(text, pattern, replacement, label):
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return updated


# Settings page
path = "web/src/pages/SettingsPage.jsx"
s = read(path)
s = replace_once(
    s,
    '        emailSubject: "",\n        emailBody: "",\n',
    '',
    'remove dead template fields',
)
s = replace_once(
    s,
    '        emailSubject: form.emailSubject || "",\n        emailBody: form.emailBody || "",\n',
    '',
    'remove dead template normalization',
)
s = replace_once(
    s,
    '    const [templateLoaded, setTemplateLoaded] = useState(false);\n',
    '    const templateLoaded = true;\n',
    'remove template loading state',
)
s = regex_once(
    s,
    r'\n    useEffect\(\(\) => \{\n        let cancelled = false;\n\n        async function loadTemplate\(\) \{.*?\n    \}, \[\]\);\n',
    '\n',
    'remove dead template loader',
)

current_save = '''            await apiSend("/admin/settings", "PATCH", {
                brandingName: form.brandingName,
                locale: form.locale,
                enabledLanguages: form.enabledLanguages,
                brandingPrimaryColor: form.brandingPrimaryColor,
                merchantNotification: form.merchantNotification,
                legalPageUrl: form.legalPageUrl,
                privacyPageUrl: form.privacyPageUrl,
                supportEmail: form.supportEmail,
                withdrawalDays: form.withdrawalDays,
                emailDeliveryMethod: form.emailDeliveryMethod,
            });

            let savedSmtp = null;

            if (boot.isPro) {
                const smtpResponse = await apiSend("/admin/smtp", "PATCH", {
                    smtpEnabled: form.emailDeliveryMethod === "SMTP",
                    smtpHost: form.smtpHost,
                    smtpPort: Number(form.smtpPort),
                    smtpSecure: form.smtpSecure,
                    smtpUsername: form.smtpUsername,
                    smtpPassword: form.smtpPassword || undefined,
                    smtpFromName: form.smtpFromName,
                    smtpFromEmail: form.smtpFromEmail,
                });
                savedSmtp = smtpResponse.settings;
            }
'''
atomic_save = '''            const settingsResponse = await apiSend("/admin/settings", "PATCH", {
                brandingName: form.brandingName,
                locale: form.locale,
                enabledLanguages: form.enabledLanguages,
                brandingPrimaryColor: form.brandingPrimaryColor,
                merchantNotification: form.merchantNotification,
                legalPageUrl: form.legalPageUrl,
                privacyPageUrl: form.privacyPageUrl,
                supportEmail: form.supportEmail,
                withdrawalDays: form.withdrawalDays,
                emailDeliveryMethod: form.emailDeliveryMethod,
                ...(boot.isPro ? {
                    smtpEnabled: form.emailDeliveryMethod === "SMTP",
                    smtpHost: form.smtpHost,
                    smtpPort: Number(form.smtpPort),
                    smtpSecure: form.smtpSecure,
                    smtpUsername: form.smtpUsername,
                    smtpPassword: form.smtpPassword || undefined,
                    smtpFromName: form.smtpFromName,
                    smtpFromEmail: form.smtpFromEmail,
                } : {}),
            });

            const savedSmtp = boot.isPro ? settingsResponse.shop : null;
'''
s = replace_once(s, current_save, atomic_save, 'atomic settings save')

clear_error = '''    function clearError() {
        setState((current) => ({ ...current, error: "" }));
    }
'''
dirty_helper = clear_error + '''
    function blockSideActionWhenDirty(action) {
        if (!hasUnsavedChanges) return false;
        setState((current) => ({
            ...current,
            error: `Save or discard your other settings before you ${action}.`,
        }));
        return true;
    }
'''
s = replace_once(s, clear_error, dirty_helper, 'dirty action helper')

for fn, action in [
    ('disconnectSmtp', 'disconnect SMTP'),
    ('createDomain', 'create a sending domain'),
    ('saveDomainSender', 'save the sender address'),
    ('removeDomain', 'remove the sending domain'),
]:
    anchor = f'    async function {fn}() {{\n'
    s = replace_once(
        s,
        anchor,
        anchor + f'        if (blockSideActionWhenDirty("{action}")) return;\n',
        f'{fn} dirty guard',
    )

refresh_anchor = '    async function refreshDomain() {\n'
s = replace_once(
    s,
    refresh_anchor,
    refresh_anchor + '        if (blockSideActionWhenDirty("check the sending domain status")) return;\n',
    'refresh domain dirty guard',
)

old_refresh = '''            setForm((current) => ({
                ...current,
                resendDomainName: settings.resendDomainName || current.resendDomainName,
                resendFromName: settings.resendFromName || current.resendFromName,
                resendFromEmail: settings.resendFromEmail || current.resendFromEmail,
            }));
'''
new_refresh = '''            commitSavedForm({
                ...form,
                resendDomainName: settings.resendDomainName || form.resendDomainName,
                resendFromName: settings.resendFromName || form.resendFromName,
                resendFromEmail: settings.resendFromEmail || form.resendFromEmail,
            });
'''
s = replace_once(s, old_refresh, new_refresh, 'refresh domain baseline')
write(path, s)


# Admin API
path = "src/routes/admin.js"
s = read(path)
s = replace_once(
    s,
    "import { buildManagedPricingUrl } from '../lib/shopify.js';\nimport { syncManagedPricingForShop } from '../lib/shopify.js';\n",
    "import { buildManagedPricingUrl, SHOPIFY_ADMIN_API_VERSION, syncManagedPricingForShop } from '../lib/shopify.js';\n",
    'shopify imports',
)

old_me_catch = '''    } catch (error) {
        console.error(
            "Partner API billing reconciliation failed:",
            error.message
        );
        return res.status(503).json({
            error: "Could not verify Shopify App Pricing entitlement.",
        });
    }
'''
new_me_catch = '''    } catch (error) {
        console.error(
            "Partner API billing reconciliation failed:",
            error.message
        );

        // Keep a merchant online during a transient Partner API failure only
        // while the locally cached entitlement is still valid and fresh.
        if (hasAppEntitlement(req.shop)) {
            shop = req.shop;
        } else {
            return res.status(503).json({
                error: "Could not verify Shopify App Pricing entitlement.",
            });
        }
    }
'''
s = replace_once(s, old_me_catch, new_me_catch, 'cached billing fallback')
s = replace_once(
    s,
    '      // English plus a maximum of three additional languages.\n',
    '      // English plus one additional language.\n',
    'admin language comment',
)

smtp_atomic = '''
    if (shopIsPro) {
      const smtpFieldsSubmitted = [
        "smtpEnabled",
        "smtpHost",
        "smtpPort",
        "smtpSecure",
        "smtpUsername",
        "smtpPassword",
        "smtpFromName",
        "smtpFromEmail",
      ].some((key) => Object.hasOwn(req.body, key));

      if (smtpFieldsSubmitted) {
        const enabled = Boolean(req.body.smtpEnabled);
        const host = String(req.body.smtpHost || "").trim();
        const username = String(req.body.smtpUsername || "").trim();
        const fromName = String(req.body.smtpFromName || "").trim();
        const fromEmail = String(req.body.smtpFromEmail || "").trim();
        const password = typeof req.body.smtpPassword === "string"
            ? req.body.smtpPassword
            : "";
        const port = Number.parseInt(req.body.smtpPort, 10);
        const secure = Boolean(req.body.smtpSecure);

        if (enabled) {
          if (!host) {
            return res.status(400).json({ error: "SMTP host is required." });
          }
          if (!isAllowedSmtpPort(port)) {
            return res.status(400).json({
              error: "SMTP verification is limited to ports 465 and 587.",
            });
          }
          if (!username) {
            return res.status(400).json({ error: "SMTP username is required." });
          }
          if (!fromEmail) {
            return res.status(400).json({ error: "From email is required." });
          }
          if (!password && !shop.smtpPasswordEncrypted) {
            return res.status(400).json({ error: "SMTP password is required." });
          }
        }

        const smtpConfigurationChanged =
            enabled !== Boolean(shop.smtpEnabled) ||
            host !== String(shop.smtpHost || "") ||
            (Number.isInteger(port) ? port : null) !== (shop.smtpPort ?? null) ||
            secure !== Boolean(shop.smtpSecure) ||
            username !== String(shop.smtpUsername || "") ||
            fromName !== String(shop.smtpFromName || "") ||
            fromEmail !== String(shop.smtpFromEmail || "") ||
            Boolean(password);

        Object.assign(patch, {
          smtpEnabled: enabled,
          smtpHost: host || null,
          smtpPort: Number.isInteger(port) ? port : null,
          smtpSecure: secure,
          smtpUsername: username || null,
          smtpFromName: fromName || null,
          smtpFromEmail: fromEmail || null,
          ...(smtpConfigurationChanged
              ? { smtpVerifiedAt: null, smtpLastError: null }
              : {}),
          ...(password
              ? { smtpPasswordEncrypted: encryptSecret(password) }
              : {}),
        });
      }
    }
'''
s = replace_once(
    s,
    '    const cleaned = Object.fromEntries(\n',
    smtp_atomic + '\n    const cleaned = Object.fromEntries(\n',
    'atomic SMTP validation and patch',
)

s = replace_once(
    s,
    '''      return res.json({
          shop: publicShopView(updated),
      });
''',
    '''      return res.json({
          shop: {
              ...publicShopView(updated),
              ...publicSmtpSettings(updated),
              ...publicResendDomainSettings(updated),
          },
      });
''',
    'settings response includes email state',
)

s = replace_once(
    s,
    '''    const password =
        typeof smtpPassword === "string"
            ? smtpPassword.trim()
            : "";
''',
    '''    const password =
        typeof smtpPassword === "string"
            ? smtpPassword
            : "";
''',
    'preserve exact SMTP password',
)

s = regex_once(
    s,
    r'\n// GET /admin/email-templates\nadminRouter\.get\(\'/email-templates\'.*?\n\);\n\nadminRouter\.delete\(',
    '\nadminRouter.delete(',
    'remove disabled email template routes',
)
s = s.replace(
    '/admin/api/2026-04/graphql.json',
    '/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json',
)
write(path, s)


# Storefront proxy consistency
path = "src/routes/proxy.js"
s = read(path)
s = replace_once(
    s,
    '// Free users: English plus up to three additional languages.',
    '// Free users: English plus one additional language.',
    'proxy language comment',
)
s = replace_once(s, '].slice(0, 4);', '].slice(0, 2);', 'proxy language limit')
s = replace_once(
    s,
    '''                /*
                 * The form remains available, but no automatic
                 * customer confirmation is currently sent.
                 */
                emailConfirmationsEnabled:
                    false,
''',
    '''                // Verified submissions trigger the server-controlled
                // confirmation email flow.
                emailConfirmationsEnabled:
                    true,
''',
    'proxy confirmation flag',
)
write(path, s)


# Shopify API and pricing configuration
path = "src/lib/shopify.js"
s = read(path)
s = replace_once(
    s,
    "const SHOPIFY_APP_HANDLE = process.env.SHOPIFY_APP_HANDLE || 'eu-withdrawal-button-2026';\n",
    "const SHOPIFY_APP_HANDLE = process.env.SHOPIFY_APP_HANDLE || 'eu-withdrawal-button-2026';\nexport const SHOPIFY_ADMIN_API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || '2026-04';\n",
    'central admin API version',
)

old_map = '''  const liveProHandle = String(
      process.env.SHOPIFY_MANAGED_PRICING_PRO_HANDLE || "pro"
  )
      .trim()
      .toLowerCase();

  const proHandles = new Set([
    liveProHandle,
    "pro-test",
  ]);

  return proHandles.has(value) ? "PRO" : "PAYMENT_REQUIRED";
'''
s = replace_once(
    s,
    old_map,
    '  return isPaidPlanHandle(value) ? "PRO" : "PAYMENT_REQUIRED";\n',
    'single paid handle source of truth',
)
s = replace_once(
    s,
    '`https://${normalizedShop}/admin/api/2026-01/graphql.json`',
    '`https://${normalizedShop}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`',
    'central GraphQL version',
)
s = replace_once(
    s,
    '  assertIdentityValue(localShop?.id, localShop?.id, "Admin Shop ID is missing");\n',
    '''  if (!localShop?.id) {
    throw new Error("Shopify billing identity mismatch: Admin Shop ID is missing");
  }
''',
    'real missing shop ID check',
)
s = replace_once(
    s,
    "  scopes: ['read_orders'], // match your toml\n  hostName: process.env.APP_URL.replace(/https?:\\/\\//, ''),\n  apiVersion: \"2024-10\",\n",
    '''  scopes: String(
      process.env.SHOPIFY_SCOPES ||
      "read_orders,write_online_store_pages,write_app_proxy"
  ).split(",").map((scope) => scope.trim()).filter(Boolean),
  hostName: DEFAULT_APP_URL.replace(/https?:\\/\\//, ''),
  apiVersion: SHOPIFY_ADMIN_API_VERSION,
''',
    'SDK scopes and API version',
)
write(path, s)


# Sanity checks
combined = "\n".join(read(p) for p in [
    "web/src/pages/SettingsPage.jsx",
    "src/routes/admin.js",
    "src/routes/proxy.js",
    "src/lib/shopify.js",
])
forbidden = [
    'apiGet("/admin/email-templates")',
    'smtpPassword.trim()',
    '"pro-test",',
    '/admin/api/2026-01/graphql.json',
    "scopes: ['read_orders']",
    '].slice(0, 4);',
]
for item in forbidden:
    if item in combined:
        raise SystemExit(f"old bug pattern still present: {item}")

print("Audited source fixes applied successfully")
