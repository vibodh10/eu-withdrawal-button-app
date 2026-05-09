import {useEffect, useMemo, useState} from "react";
import {Page, Layout, Card, Text, TextField, Button, Banner, BlockStack, InlineStack, Box} from "@shopify/polaris";
import {apiGet, apiSend} from "../api";

export default function SettingsPage({ boot, onReload }) {
  const shop = boot.shop;

  const [form, setForm] = useState({
    brandingName: shop.brandingName || "",
    locale: shop.locale || "en",
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

                <TextField label="Locale" value={form.locale} onChange={(v) => updateField("locale", v)} />
                <TextField label="Merchant notification email" value={form.merchantNotification} onChange={(v) => updateField("merchantNotification", v)} />

                {proLocked && (
                    <Banner
                        tone="info"
                        title="Upgrade to Pro to unlock advanced settings"
                    >
                      Custom emails, legal settings, and adjustable withdrawal periods are available on Pro.
                    </Banner>
                )}
                <TextField label="Legal page URL" value={form.legalPageUrl} disabled={proLocked} onChange={(v) => updateField("legalPageUrl", v)} />
                <TextField label="Privacy page URL" value={form.privacyPageUrl} disabled={proLocked} onChange={(v) => updateField("privacyPageUrl", v)} />
                <TextField label="Support email" value={form.supportEmail} disabled={proLocked} onChange={(v) => updateField("supportEmail", v)} />

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
                        background: form.brandingPrimaryColor || "#111827",
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