import {
  Page,
  Layout,
  Card,
  Text,
  TextField,
  Button,
  Banner,
  BlockStack,
  InlineStack,
  Box,
  ChoiceList,
  Select,
  Badge,
} from "@shopify/polaris";
import {useEffect, useMemo, useState} from "react";
import {apiGet, apiSend} from "../api.js";

const LANGUAGE_OPTIONS = [
  { label: "English", value: "en" },
  { label: "Deutsch", value: "de" },
  { label: "Français", value: "fr" },
  { label: "Italiano", value: "it" },
  { label: "Español", value: "es" },
  { label: "Português", value: "pt" },
  { label: "Nederlands", value: "nl" },
  { label: "Polski", value: "pl" },
  { label: "Dansk", value: "da" },
  { label: "Svenska", value: "sv" },
  { label: "Suomi", value: "fi" },
  { label: "Čeština", value: "cs" },
  { label: "Slovenčina", value: "sk" },
  { label: "Slovenščina", value: "sl" },
  { label: "Hrvatski", value: "hr" },
  { label: "Magyar", value: "hu" },
  { label: "Română", value: "ro" },
  { label: "Български", value: "bg" },
  { label: "Ελληνικά", value: "el" },
  { label: "Eesti", value: "et" },
  { label: "Latviešu", value: "lv" },
  { label: "Lietuvių", value: "lt" },
  { label: "Gaeilge", value: "ga" },
  { label: "Malti", value: "mt" },
];

const DEFAULT_LANGUAGES = ["en", "de", "fr", "it"];

function parseEnabledLanguages(value) {
  if (Array.isArray(value)) {
    return value;
  }

  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) && parsed.length
        ? parsed
        : DEFAULT_LANGUAGES;
  } catch {
    return DEFAULT_LANGUAGES;
  }
}

export default function SettingsPage({ boot, onReload }) {
  const shop = boot.shop;

  const [form, setForm] = useState({
    brandingName: shop.brandingName || "",
    locale: shop.locale || "en",
    enabledLanguages: parseEnabledLanguages(shop.enabledLanguages),
    brandingPrimaryColor: shop.brandingPrimaryColor || "#111827",
    merchantNotification: shop.merchantNotification || "",
    legalPageUrl: shop.legalPageUrl || "",
    privacyPageUrl: shop.privacyPageUrl || "",
    supportEmail: shop.supportEmail || "",
    withdrawalDays: shop.withdrawalDays || 14,
  });

  const [state, setState] = useState({ saving: false, message: "", error: "" });
  const proLocked = useMemo(() => !boot.isPro, [boot.isPro]);

  useEffect(() => {
    async function loadTemplate() {
      try {
        const res = await apiGet("/admin/email-templates");

        const template = res.templates?.find(t => t.code === "CONFIRMATION");

        if (template) {
          setForm(prev => ({
            ...prev,
            emailSubject: template.subject,
            emailBody: template.bodyHtml
          }));
        }
      } catch (e) {
        console.error(e);
      }
    }

    loadTemplate();
  }, []);

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateEnabledLanguages(selected) {
    setState((prev) => ({
      ...prev,
      message: "",
      error: "",
    }));

    let nextLanguages = [...new Set(selected)];

    if (!boot.isPro) {
      // English is always included on Basic.
      if (!nextLanguages.includes("en")) {
        nextLanguages = ["en", ...nextLanguages];
      }

      if (nextLanguages.length > 4) {
        setState({
          saving: false,
          message: "",
          error:
              "The Basic plan includes English plus up to 3 additional languages.",
        });
        return;
      }
    }

    if (nextLanguages.length === 0) {
      setState({
        saving: false,
        message: "",
        error: "Select at least one language.",
      });
      return;
    }

    setForm((prev) => {
      const nextDefaultLanguage = nextLanguages.includes(prev.locale)
          ? prev.locale
          : nextLanguages.includes("en")
              ? "en"
              : nextLanguages[0];

      return {
        ...prev,
        enabledLanguages: nextLanguages,
        locale: nextDefaultLanguage,
      };
    });
  }

  const defaultLanguageOptions = LANGUAGE_OPTIONS.filter((language) =>
      form.enabledLanguages.includes(language.value)
  );

  async function save() {
    try {
      setState({ saving: true, message: "", error: "" });
      await apiSend("/admin/settings", "PATCH", form);
      setState({ saving: false, message: "Settings saved." });
      onReload?.();
    } catch (e) {
      setState({ saving: false, error: e.message });
    }
  }

  return (
      <Page title="Settings">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd">General settings</Text>

                <Card background="bg-surface-secondary">
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text variant="headingMd">Customer form languages</Text>

                        <Text as="p" tone="subdued">
                          Choose the languages customers can use in the withdrawal form.
                        </Text>
                      </BlockStack>

                      <Badge tone={boot.isPro ? "success" : "info"}>
                        {boot.isPro ? "Pro" : "Basic"}
                      </Badge>
                    </InlineStack>

                    {!boot.isPro && (
                        <Banner tone="info">
                          <Text as="p">
                            The Basic plan includes English plus up to 3 additional
                            languages. Upgrade to Pro to enable all supported languages.
                          </Text>
                        </Banner>
                    )}

                    <ChoiceList
                        title="Languages available to customers"
                        allowMultiple
                        choices={LANGUAGE_OPTIONS.map((language) => ({
                          ...language,
                          disabled:
                              !boot.isPro &&
                              language.value !== "en" &&
                              !form.enabledLanguages.includes(language.value) &&
                              form.enabledLanguages.length >= 4,
                        }))}
                        selected={form.enabledLanguages}
                        onChange={updateEnabledLanguages}
                    />

                    <Select
                        label="Default language"
                        helpText="The form opens in this language. Customers can switch to another enabled language."
                        options={defaultLanguageOptions}
                        value={form.locale}
                        onChange={(value) => updateField("locale", value)}
                    />
                  </BlockStack>
                </Card>
                <TextField label="Merchant notification email" value={form.merchantNotification} onChange={(v) => updateField("merchantNotification", v)} />

                {proLocked && (
                    <Banner
                        tone="info"
                        title="Upgrade to Pro to unlock advanced settings"
                    >
                      Adjustable withdrawal periods are available on Pro.
                    </Banner>
                )}
                <TextField label="Legal page URL" value={form.legalPageUrl} onChange={(v) => updateField("legalPageUrl", v)} />
                <TextField label="Privacy page URL" value={form.privacyPageUrl} onChange={(v) => updateField("privacyPageUrl", v)} />
                <TextField label="Support email" value={form.supportEmail} onChange={(v) => updateField("supportEmail", v)} />

                {proLocked && (
                    <Text variant="bodySm" tone="subdued">
                      Basic plan uses a standard 14-day withdrawal baseline. Validation is not enforced.
                    </Text>
                )}

                <TextField
                    label="Withdrawal period (days)"
                    helpText={
                      proLocked
                          ? "A 14-day baseline is applied for customer guidance. Upgrade to Pro to customise and enable automatic validation."
                          : "Set your withdrawal period. Requests will be validated against this when possible."
                    }
                    type="number"
                    value={String(form.withdrawalDays)}
                    disabled={proLocked}
                    onChange={(v) => updateField("withdrawalDays", v)}
                />

                <Button variant="primary" onClick={save} loading={state.saving}>
                  Save settings
                </Button>

                {state.message && <Banner tone="success">{state.message}</Banner>}
                {state.error && <Banner tone="critical">{state.error}</Banner>}
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd">Branding</Text>

                {proLocked && (
                    <Banner
                        tone="info"
                        title="Upgrade to Pro to unlock custom branding"
                    >
                      Make your branding unique by adding a custom colour to customer emails and withdrawal communications.
                    </Banner>
                )}

                <TextField
                    label="Brand name"
                    value={form.brandingName}
                    onChange={(v) => updateField("brandingName", v)}
                    helpText="Used in customer emails and withdrawal request communications."
                />

                <InlineStack gap="300" align="start">
                  <div style={{ flex: 1 }}>
                    <TextField
                        label="Primary brand color"
                        value={form.brandingPrimaryColor}
                        disabled={proLocked}
                        onChange={(v) => updateField("brandingPrimaryColor", v)}
                        autoComplete="off"
                        helpText="Example: #111827"
                    />
                  </div>

                  <div style={{ paddingTop: "28px" }}>
                    <input
                        type="color"
                        value={form.brandingPrimaryColor}
                        disabled={proLocked}
                        onChange={(e) =>
                            updateField("brandingPrimaryColor", e.target.value)
                        }
                        style={{
                          width: 48,
                          height: 48,
                          border: "none",
                          background: "transparent",
                          cursor: proLocked ? "not-allowed" : "pointer"
                        }}
                    />
                  </div>
                </InlineStack>

                <Box
                    padding="400"
                    borderWidth="025"
                    borderRadius="300"
                    background="bg-surface-secondary"
                >
                  <div
                      style={{
                        background: form.brandingPrimaryColor || "#0041c2",
                        padding: "16px",
                        borderRadius: "8px",
                        marginBottom: "16px",
                        opacity: proLocked ? 0.6 : 1
                      }}
                  >
                    <h2
                        style={{
                          color: "#fff",
                          margin: 0,
                          fontSize: "20px"
                        }}
                    >
                      {form.brandingName || "Your Brand"}
                    </h2>
                  </div>

                  <Text as="p" variant="bodyMd">
                    This is how your email branding header will appear to customers.
                  </Text>
                </Box>

                <Button
                    variant="primary"
                    onClick={save}
                    loading={state.saving}
                >
                  Save Branding
                </Button>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd">Email Templates</Text>

                {proLocked && (
                    <Banner
                        tone="info"
                        title="Upgrade to Pro to unlock custom email templates"
                    >
                      Customize confirmation emails sent to customers with your own branding, messaging, and HTML templates.
                    </Banner>
                )}

                <Text variant="bodySm" tone="subdued">
                  Customize the confirmation email sent to customers.
                  You can use variables like {"{{reference}}"}, {"{{shopName}}"}, {"{{customerEmail}}"} and {"{{customerName}}"}.
                </Text>

                <TextField
                    label="Email Subject"
                    value={form.emailSubject || ""}
                    disabled={proLocked}
                    onChange={(v) => updateField("emailSubject", v)}
                />

                <TextField
                    label="Email HTML"
                    multiline={6}
                    value={form.emailBody || ""}
                    disabled={proLocked}
                    onChange={(v) => updateField("emailBody", v)}
                />

                <Button
                    variant="primary"
                    onClick={async () => {
                      try {
                        await apiSend("/admin/email-templates/CONFIRMATION", "PATCH", {
                          subject: form.emailSubject,
                          bodyHtml: form.emailBody
                        });

                        setState({ saving: false, message: "Template saved." });
                      } catch (e) {
                        setState({ saving: false, error: e.message });
                      }
                    }}
                    loading={state.saving}
                    disabled={proLocked}
                >
                  Save Template
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
  );
}