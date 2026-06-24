import {
  Page, Layout, Card, Text, TextField, Banner, BlockStack, InlineStack,
  Box, ChoiceList, Select, Badge, Button, DataTable,
} from "@shopify/polaris";
import { useEffect, useMemo, useRef, useState } from "react";
import { ContextualSaveBar } from "@shopify/app-bridge/actions";
import { apiGet, apiSend } from "../api.js";
import { app } from "../appBridge.js";

const LANGUAGE_OPTIONS = [
  ["English", "en"], ["Deutsch", "de"], ["Français", "fr"],
  ["Italiano", "it"], ["Español", "es"], ["Português", "pt"],
  ["Nederlands", "nl"], ["Polski", "pl"], ["Dansk", "da"],
  ["Svenska", "sv"], ["Suomi", "fi"], ["Čeština", "cs"],
  ["Slovenčina", "sk"], ["Slovenščina", "sl"], ["Hrvatski", "hr"],
  ["Magyar", "hu"], ["Română", "ro"], ["Български", "bg"],
  ["Ελληνικά", "el"], ["Eesti", "et"], ["Latviešu", "lv"],
  ["Lietuvių", "lt"], ["Gaeilge", "ga"], ["Malti", "mt"],
].map(([label, value]) => ({ label, value }));

const DEFAULT_LANGUAGES = ["en", "de"];

function parseEnabledLanguages(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) && parsed.length ? parsed : [...DEFAULT_LANGUAGES];
  } catch {
    return [...DEFAULT_LANGUAGES];
  }
}

function createInitialForm(shop) {
  return {
    brandingName: shop?.brandingName || "",
    locale: shop?.locale || "en",
    enabledLanguages: parseEnabledLanguages(shop?.enabledLanguages),
    brandingPrimaryColor: shop?.brandingPrimaryColor || "#111827",
    merchantNotification: shop?.merchantNotification || "",
    legalPageUrl: shop?.legalPageUrl || "",
    privacyPageUrl: shop?.privacyPageUrl || "",
    supportEmail: shop?.supportEmail || "",
    withdrawalDays: shop?.withdrawalDays || 14,
    emailDeliveryMethod:
        shop?.emailDeliveryMethod || (shop?.smtpEnabled ? "SMTP" : "GL6"),
    smtpHost: shop?.smtpHost || "",
    smtpPort: String(shop?.smtpPort || 587),
    smtpSecure: Boolean(shop?.smtpSecure),
    smtpUsername: shop?.smtpUsername || "",
    smtpPassword: "",
    smtpFromName: shop?.smtpFromName || "",
    smtpFromEmail: shop?.smtpFromEmail || "",
    resendDomainName: shop?.resendDomainName || "",
    resendFromName: shop?.resendFromName || "",
    resendFromEmail: shop?.resendFromEmail || "",
    emailSubject: "",
    emailBody: "",
  };
}

function cloneForm(form) {
  return { ...form, enabledLanguages: [...(form.enabledLanguages || [])] };
}

function normaliseForm(form) {
  return {
    ...form,
    enabledLanguages: [...(form.enabledLanguages || [])].sort(),
    withdrawalDays: String(form.withdrawalDays || 14),
    smtpPort: String(form.smtpPort || 587),
    emailSubject: form.emailSubject || "",
    emailBody: form.emailBody || "",
  };
}

function formsAreEqual(a, b) {
  return JSON.stringify(normaliseForm(a)) === JSON.stringify(normaliseForm(b));
}

function statusLabel(value) {
  if (!value) return "Not configured";
  return String(value)
      .replaceAll("_", " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusTone(value) {
  const status = String(value || "").toLowerCase();
  if (status === "verified") return "success";
  if (["failed", "failure"].includes(status)) return "critical";
  if (["pending", "not_started", "temporary_failure"].includes(status)) {
    return "attention";
  }
  return "info";
}

export default function SettingsPage({ boot, onReload, onDirtyChange }) {
  const proLocked = !boot.isPro;
  const initialFormRef = useRef(createInitialForm(boot.shop));
  const [form, setForm] = useState(() => cloneForm(initialFormRef.current));
  const savedFormRef = useRef(cloneForm(initialFormRef.current));
  const contextualSaveBarRef = useRef(null);
  const saveHandlerRef = useRef(null);
  const discardHandlerRef = useRef(null);
  const [templateLoaded, setTemplateLoaded] = useState(false);
  const [state, setState] = useState({ saving: false, error: "" });

  const [smtpStatus, setSmtpStatus] = useState({
    hasPassword: Boolean(boot.shop?.smtpHasPassword),
    verifiedAt: boot.shop?.smtpVerifiedAt || null,
    lastError: boot.shop?.smtpLastError || null,
    testing: false,
    disconnecting: false,
  });

  const [domainState, setDomainState] = useState({
    domainId: boot.shop?.resendDomainId || null,
    status: boot.shop?.resendDomainStatus || null,
    records: [],
    loading: false,
    creating: false,
    verifying: false,
    savingSender: false,
    removing: false,
    lastError: boot.shop?.resendDomainLastError || null,
  });

  const hasUnsavedChanges =
      templateLoaded && !formsAreEqual(form, savedFormRef.current);

  useEffect(() => {
    if (!templateLoaded || contextualSaveBarRef.current) return;

    const saveBar = ContextualSaveBar.create(app, {
      saveAction: { disabled: false, loading: false },
      discardAction: { disabled: false },
    });

    contextualSaveBarRef.current = saveBar;
    saveBar.dispatch(ContextualSaveBar.Action.HIDE);

    const unsubscribeSave = saveBar.subscribe(
        ContextualSaveBar.Action.SAVE,
        () => saveHandlerRef.current?.()
    );
    const unsubscribeDiscard = saveBar.subscribe(
        ContextualSaveBar.Action.DISCARD,
        () => discardHandlerRef.current?.()
    );

    return () => {
      unsubscribeSave?.();
      unsubscribeDiscard?.();
      saveBar.dispatch(ContextualSaveBar.Action.HIDE);
      contextualSaveBarRef.current = null;
    };
  }, [templateLoaded]);

  useEffect(() => {
    onDirtyChange?.(hasUnsavedChanges);
    return () => onDirtyChange?.(false);
  }, [hasUnsavedChanges, onDirtyChange]);

  useEffect(() => {
    let cancelled = false;

    async function loadTemplate() {
      try {
        const response = await apiGet("/admin/email-templates");
        const template = response.templates?.find(
            (item) => item.code === "CONFIRMATION"
        );
        if (cancelled) return;

        const loaded = cloneForm({
          ...initialFormRef.current,
          emailSubject: template?.subject || "",
          emailBody: template?.bodyHtml || "",
        });
        setForm(loaded);
        savedFormRef.current = cloneForm(loaded);
      } catch (error) {
        if (!cancelled) {
          setState({
            saving: false,
            error: "Could not load the email template.",
          });
        }
      } finally {
        if (!cancelled) setTemplateLoaded(true);
      }
    }

    loadTemplate();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!boot.isPro || !boot.shop?.resendDomainId) return;
    refreshDomain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot.isPro, boot.shop?.resendDomainId]);

  useEffect(() => {
    const saveBar = contextualSaveBarRef.current;
    if (!saveBar || !templateLoaded) return;

    if (!hasUnsavedChanges) {
      saveBar.dispatch(ContextualSaveBar.Action.HIDE);
      return;
    }

    saveBar.set({
      saveAction: { disabled: state.saving, loading: state.saving },
      discardAction: { disabled: state.saving },
    });
    saveBar.dispatch(ContextualSaveBar.Action.SHOW);
  }, [hasUnsavedChanges, state.saving, templateLoaded]);

  function clearError() {
    setState((current) => ({ ...current, error: "" }));
  }

  function updateField(key, value) {
    clearError();
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateSmtpField(key, value) {
    clearError();
    setForm((current) => ({ ...current, [key]: value }));
    setSmtpStatus((current) => ({
      ...current,
      verifiedAt: null,
      lastError: null,
    }));
  }

  function updateEnabledLanguages(selected) {
    clearError();
    let next = [...new Set(selected)];

    if (!boot.isPro) {
      if (!next.includes("en")) next = ["en", ...next];
      if (next.length > 2) {
        setState({
          saving: false,
          error: "The Basic plan includes English plus 1 additional language.",
        });
        return;
      }
    }

    if (!next.length) {
      setState({ saving: false, error: "Select at least one language." });
      return;
    }

    setForm((current) => ({
      ...current,
      enabledLanguages: next,
      locale: next.includes(current.locale)
          ? current.locale
          : next.includes("en")
              ? "en"
              : next[0],
    }));
  }

  const defaultLanguageOptions = useMemo(
      () =>
          LANGUAGE_OPTIONS.filter((language) =>
              form.enabledLanguages.includes(language.value)
          ),
      [form.enabledLanguages]
  );

  async function save() {
    if (!hasUnsavedChanges || state.saving) return;

    try {
      setState({ saving: true, error: "" });

      await apiSend("/admin/settings", "PATCH", {
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

        await apiSend("/admin/email-templates/CONFIRMATION", "PATCH", {
          subject: form.emailSubject || "",
          bodyHtml: form.emailBody || "",
        });
      }

      const saved = cloneForm({ ...form, smtpPassword: "" });
      setForm(saved);
      savedFormRef.current = cloneForm(saved);

      if (savedSmtp) {
        setSmtpStatus((current) => ({
          ...current,
          hasPassword: Boolean(savedSmtp.smtpHasPassword),
          verifiedAt: savedSmtp.smtpVerifiedAt || null,
          lastError: savedSmtp.smtpLastError || null,
        }));
      }

      setState({ saving: false, error: "" });
      onDirtyChange?.(false);
      await onReload?.({ silent: true });
    } catch (error) {
      setState({
        saving: false,
        error: error.message || "Could not save settings.",
      });
      contextualSaveBarRef.current?.dispatch(ContextualSaveBar.Action.SHOW);
    }
  }

  function discardChanges() {
    setForm(cloneForm(savedFormRef.current));
    setState({ saving: false, error: "" });
    onDirtyChange?.(false);
  }

  async function testSmtpConnection() {
    if (hasUnsavedChanges) {
      setState((current) => ({
        ...current,
        error: "Save your SMTP settings before testing the connection.",
      }));
      return;
    }

    try {
      setSmtpStatus((current) => ({ ...current, testing: true, lastError: null }));
      const response = await apiSend("/admin/smtp/test", "POST");
      setSmtpStatus((current) => ({
        ...current,
        testing: false,
        hasPassword: Boolean(response.settings?.smtpHasPassword),
        verifiedAt: response.settings?.smtpVerifiedAt || null,
        lastError: null,
      }));
    } catch (error) {
      const message = error.message || "SMTP connection failed.";
      setSmtpStatus((current) => ({
        ...current,
        testing: false,
        verifiedAt: null,
        lastError: message,
      }));
      setState((current) => ({ ...current, error: message }));
    }
  }

  async function disconnectSmtp() {
    try {
      setSmtpStatus((current) => ({ ...current, disconnecting: true }));
      await apiSend("/admin/smtp", "DELETE");

      const reset = cloneForm({
        ...form,
        emailDeliveryMethod: "GL6",
        smtpHost: "",
        smtpPort: "587",
        smtpSecure: false,
        smtpUsername: "",
        smtpPassword: "",
        smtpFromName: "",
        smtpFromEmail: "",
      });

      setForm(reset);
      savedFormRef.current = cloneForm(reset);
      setSmtpStatus({
        hasPassword: false,
        verifiedAt: null,
        lastError: null,
        testing: false,
        disconnecting: false,
      });
      setState({ saving: false, error: "" });
      onDirtyChange?.(false);
      await onReload?.({ silent: true });
    } catch (error) {
      setSmtpStatus((current) => ({ ...current, disconnecting: false }));
      setState((current) => ({
        ...current,
        error: error.message || "Could not disconnect SMTP.",
      }));
    }
  }

  async function createDomain() {
    const domainName = String(form.resendDomainName || "").trim();
    if (!domainName) {
      setState((current) => ({
        ...current,
        error: "Enter a domain or subdomain first.",
      }));
      return;
    }

    try {
      setDomainState((current) => ({ ...current, creating: true, lastError: null }));
      const response = await apiSend("/admin/resend-domain", "POST", { domainName });
      const settings = response.settings || {};
      const next = cloneForm({
        ...form,
        emailDeliveryMethod: "RESEND_DOMAIN",
        resendDomainName: settings.resendDomainName || domainName,
      });
      setForm(next);
      savedFormRef.current = cloneForm(next);
      setDomainState((current) => ({
        ...current,
        domainId: settings.resendDomainId || current.domainId,
        status: settings.resendDomainStatus || null,
        records: response.records || [],
        creating: false,
        lastError: null,
      }));
      onDirtyChange?.(false);
      await onReload?.({ silent: true });
    } catch (error) {
      const message = error.message || "Could not create the sending domain.";
      setDomainState((current) => ({ ...current, creating: false, lastError: message }));
      setState((current) => ({ ...current, error: message }));
    }
  }

  async function refreshDomain() {
    try {
      setDomainState((current) => ({ ...current, loading: true, lastError: null }));
      const response = await apiGet("/admin/resend-domain");
      const settings = response.settings || {};
      setDomainState((current) => ({
        ...current,
        domainId: settings.resendDomainId || current.domainId,
        status: settings.resendDomainStatus || null,
        records: response.records || [],
        loading: false,
        lastError: settings.resendDomainLastError || null,
      }));
      setForm((current) => ({
        ...current,
        resendDomainName: settings.resendDomainName || current.resendDomainName,
        resendFromName: settings.resendFromName || current.resendFromName,
        resendFromEmail: settings.resendFromEmail || current.resendFromEmail,
      }));
    } catch (error) {
      const message = error.message || "Could not refresh the sending domain.";
      setDomainState((current) => ({ ...current, loading: false, lastError: message }));
      setState((current) => ({ ...current, error: message }));
    }
  }

  async function verifyDomain() {
    try {
      setDomainState((current) => ({ ...current, verifying: true, lastError: null }));
      const response = await apiSend("/admin/resend-domain/verify", "POST");
      setDomainState((current) => ({
        ...current,
        status: response.settings?.resendDomainStatus || current.status,
        verifying: false,
        lastError: null,
      }));
    } catch (error) {
      const message = error.message || "Could not start domain verification.";
      setDomainState((current) => ({ ...current, verifying: false, lastError: message }));
      setState((current) => ({ ...current, error: message }));
    }
  }

  async function saveDomainSender() {
    if (String(domainState.status || "").toLowerCase() !== "verified") {
      setState((current) => ({
        ...current,
        error: "Verify the sending domain before saving the sender address.",
      }));
      return;
    }

    try {
      setDomainState((current) => ({ ...current, savingSender: true, lastError: null }));
      const response = await apiSend("/admin/resend-domain/sender", "PATCH", {
        fromName: form.resendFromName,
        fromEmail: form.resendFromEmail,
      });
      const settings = response.settings || {};
      const next = cloneForm({
        ...form,
        emailDeliveryMethod: "RESEND_DOMAIN",
        resendFromName: settings.resendFromName || form.resendFromName,
        resendFromEmail: settings.resendFromEmail || form.resendFromEmail,
      });
      setForm(next);
      savedFormRef.current = cloneForm(next);
      setDomainState((current) => ({ ...current, savingSender: false, lastError: null }));
      onDirtyChange?.(false);
      await onReload?.({ silent: true });
    } catch (error) {
      const message = error.message || "Could not save the sender address.";
      setDomainState((current) => ({ ...current, savingSender: false, lastError: message }));
      setState((current) => ({ ...current, error: message }));
    }
  }

  async function removeDomain() {
    try {
      setDomainState((current) => ({ ...current, removing: true, lastError: null }));
      await apiSend("/admin/resend-domain", "DELETE");
      const next = cloneForm({
        ...form,
        emailDeliveryMethod: "GL6",
        resendDomainName: "",
        resendFromName: "",
        resendFromEmail: "",
      });
      setForm(next);
      savedFormRef.current = cloneForm(next);
      setDomainState({
        domainId: null,
        status: null,
        records: [],
        loading: false,
        creating: false,
        verifying: false,
        savingSender: false,
        removing: false,
        lastError: null,
      });
      setState({ saving: false, error: "" });
      onDirtyChange?.(false);
      await onReload?.({ silent: true });
    } catch (error) {
      const message = error.message || "Could not remove the sending domain.";
      setDomainState((current) => ({ ...current, removing: false, lastError: message }));
      setState((current) => ({ ...current, error: message }));
    }
  }

  saveHandlerRef.current = save;
  discardHandlerRef.current = discardChanges;

  const domainVerified =
      String(domainState.status || "").toLowerCase() === "verified";
  const dnsRows = (domainState.records || []).map((record) => [
    record.type || "—",
    record.name || "—",
    record.value || "—",
    record.priority ?? "—",
    statusLabel(record.status),
  ]);

  return (
      <Page title="Settings">
        <Layout>
          {state.error && (
              <Layout.Section>
                <Banner
                    tone="critical"
                    title="Settings could not be saved"
                    onDismiss={clearError}
                >
                  <Text as="p">{state.error}</Text>
                </Banner>
              </Layout.Section>
          )}

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
                            The Basic plan includes English plus 1 additional language.
                            Upgrade to Pro to enable all supported languages.
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
                              form.enabledLanguages.length >= 2,
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

                <TextField
                    label="Withdrawal notification email"
                    value={form.merchantNotification}
                    onChange={(value) => updateField("merchantNotification", value)}
                    helpText="Internal alerts about new withdrawal requests are sent here."
                    autoComplete="email"
                />

                {proLocked && (
                    <Banner tone="info" title="Upgrade to Pro to unlock advanced settings">
                      <Text as="p">Adjustable withdrawal periods are available on Pro.</Text>
                    </Banner>
                )}

                <TextField
                    label="Legal page URL"
                    value={form.legalPageUrl}
                    onChange={(value) => updateField("legalPageUrl", value)}
                    autoComplete="url"
                />
                <TextField
                    label="Privacy page URL"
                    value={form.privacyPageUrl}
                    onChange={(value) => updateField("privacyPageUrl", value)}
                    autoComplete="url"
                />
                <TextField
                    label="Customer support email"
                    value={form.supportEmail}
                    onChange={(value) => updateField("supportEmail", value)}
                    helpText="Shown to customers and used as the reply-to address for managed delivery."
                    autoComplete="email"
                />

                {proLocked && (
                    <Text variant="bodySm" tone="subdued">
                      The Basic plan uses a standard 14-day withdrawal baseline.
                      Automatic validation is not enforced.
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
                    onChange={(value) => updateField("withdrawalDays", value)}
                    autoComplete="off"
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text variant="headingMd">Email delivery</Text>
                    <Text as="p" tone="subdued">
                      Choose how customer confirmation emails are sent.
                    </Text>
                  </BlockStack>

                  {!boot.isPro ? (
                      <Badge tone="info">Basic</Badge>
                  ) : form.emailDeliveryMethod === "RESEND_DOMAIN" ? (
                      <Badge tone={statusTone(domainState.status)}>
                        {statusLabel(domainState.status)}
                      </Badge>
                  ) : form.emailDeliveryMethod === "SMTP" && smtpStatus.verifiedAt ? (
                      <Badge tone="success">Connected</Badge>
                  ) : form.emailDeliveryMethod === "SMTP" && smtpStatus.lastError ? (
                      <Badge tone="critical">Connection failed</Badge>
                  ) : form.emailDeliveryMethod === "SMTP" ? (
                      <Badge tone="attention">Requires testing</Badge>
                  ) : (
                      <Badge tone="success">GL6 managed</Badge>
                  )}
                </InlineStack>

                <ChoiceList
                    title="Delivery method"
                    choices={[
                      {
                        label: "GL6 managed delivery — Recommended",
                        value: "GL6",
                        helpText:
                            "Confirmation emails are sent through GL6’s verified email delivery service. Customer replies are directed to your support email.",
                      },
                      {
                        label: "Verified sending domain — Pro",
                        value: "RESEND_DOMAIN",
                        helpText:
                            "Verify your domain with DNS records and send through Resend using your own business address.",
                        disabled: !boot.isPro,
                      },
                      {
                        label: "Custom SMTP — Pro",
                        value: "SMTP",
                        helpText:
                            "Connect your own email provider using SMTP credentials.",
                        disabled: !boot.isPro,
                      },
                    ]}
                    selected={[form.emailDeliveryMethod]}
                    onChange={(selected) =>
                        updateField("emailDeliveryMethod", selected[0])
                    }
                />

                {!boot.isPro && (
                    <Banner tone="info" title="Branded email delivery is available on Pro">
                      <Text as="p">
                        Basic stores use GL6 managed delivery. Customer replies are
                        sent to the customer support email configured above.
                      </Text>
                    </Banner>
                )}

                {boot.isPro && form.emailDeliveryMethod === "RESEND_DOMAIN" && (
                    <BlockStack gap="300">
                      <Banner tone="info">
                        <Text as="p">
                          We recommend using a dedicated subdomain such as
                          withdrawals.example.com. Add the DNS records shown below,
                          then verify the domain.
                        </Text>
                      </Banner>

                      {!domainState.domainId ? (
                          <>
                            <TextField
                                label="Sending domain or subdomain"
                                value={form.resendDomainName}
                                onChange={(value) => updateField("resendDomainName", value)}
                                placeholder="withdrawals.example.com"
                                helpText="Do not include https:// or a path."
                                autoComplete="off"
                            />
                            <Button
                                variant="primary"
                                onClick={createDomain}
                                loading={domainState.creating}
                                disabled={!String(form.resendDomainName || "").trim()}
                            >
                              Add sending domain
                            </Button>
                          </>
                      ) : (
                          <>
                            <InlineStack align="space-between" blockAlign="center">
                              <BlockStack gap="100">
                                <Text variant="headingSm">{form.resendDomainName}</Text>
                                <Text as="p" tone="subdued" variant="bodySm">
                                  Add all required DNS records before starting verification.
                                </Text>
                              </BlockStack>
                              <Badge tone={statusTone(domainState.status)}>
                                {statusLabel(domainState.status)}
                              </Badge>
                            </InlineStack>

                            {dnsRows.length > 0 && (
                                <Box borderWidth="025" borderRadius="300" overflowX="scroll">
                                  <DataTable
                                      columnContentTypes={["text", "text", "text", "numeric", "text"]}
                                      headings={["Type", "Name", "Value", "Priority", "Status"]}
                                      rows={dnsRows}
                                  />
                                </Box>
                            )}

                            {domainState.lastError && (
                                <Banner tone="critical" title="Sending domain issue">
                                  <Text as="p">{domainState.lastError}</Text>
                                </Banner>
                            )}

                            <InlineStack gap="300">
                              <Button onClick={refreshDomain} loading={domainState.loading}>
                                Check status
                              </Button>
                              {!domainVerified && (
                                  <Button
                                      variant="primary"
                                      onClick={verifyDomain}
                                      loading={domainState.verifying}
                                  >
                                    Verify domain
                                  </Button>
                              )}
                              <Button
                                  tone="critical"
                                  onClick={removeDomain}
                                  loading={domainState.removing}
                              >
                                Remove domain
                              </Button>
                            </InlineStack>

                            {domainVerified && (
                                <BlockStack gap="300">
                                  <Banner tone="success" title="Sending domain verified">
                                    <Text as="p">
                                      You can now choose the sender name and email address
                                      used for customer confirmation emails.
                                    </Text>
                                  </Banner>

                                  <TextField
                                      label="From name"
                                      value={form.resendFromName}
                                      onChange={(value) => updateField("resendFromName", value)}
                                      placeholder="Your store name"
                                      autoComplete="organization"
                                  />
                                  <TextField
                                      label="From email"
                                      type="email"
                                      value={form.resendFromEmail}
                                      onChange={(value) => updateField("resendFromEmail", value)}
                                      placeholder={`withdrawals@${form.resendDomainName}`}
                                      helpText={`This address must end with @${form.resendDomainName}.`}
                                      autoComplete="email"
                                  />
                                  <Button
                                      variant="primary"
                                      onClick={saveDomainSender}
                                      loading={domainState.savingSender}
                                      disabled={!String(form.resendFromEmail || "").trim()}
                                  >
                                    Save sender details
                                  </Button>
                                </BlockStack>
                            )}
                          </>
                      )}
                    </BlockStack>
                )}

                {boot.isPro && form.emailDeliveryMethod === "SMTP" && (
                    <BlockStack gap="300">
                      <Banner tone="info">
                        <Text as="p">
                          Enter the SMTP details supplied by your email provider.
                          Save the settings before testing the connection.
                        </Text>
                      </Banner>

                      <TextField
                          label="SMTP host"
                          value={form.smtpHost}
                          onChange={(value) => updateSmtpField("smtpHost", value)}
                          placeholder="smtp.example.com"
                          autoComplete="off"
                      />
                      <TextField
                          label="SMTP port"
                          type="number"
                          value={form.smtpPort}
                          onChange={(value) => updateSmtpField("smtpPort", value)}
                          helpText="Use 587 for STARTTLS or 465 for SSL/TLS in most cases."
                          autoComplete="off"
                      />
                      <Select
                          label="Connection security"
                          options={[
                            { label: "STARTTLS — usually port 587", value: "starttls" },
                            { label: "SSL/TLS — usually port 465", value: "ssl" },
                          ]}
                          value={form.smtpSecure ? "ssl" : "starttls"}
                          onChange={(value) =>
                              updateSmtpField("smtpSecure", value === "ssl")
                          }
                      />
                      <TextField
                          label="SMTP username"
                          value={form.smtpUsername}
                          onChange={(value) => updateSmtpField("smtpUsername", value)}
                          helpText="This is often your complete email address."
                          autoComplete="off"
                      />
                      <TextField
                          label="SMTP password"
                          type="password"
                          value={form.smtpPassword}
                          onChange={(value) => updateSmtpField("smtpPassword", value)}
                          placeholder={
                            smtpStatus.hasPassword
                                ? "Leave blank to keep the saved password"
                                : "Enter SMTP password"
                          }
                          helpText={
                            smtpStatus.hasPassword
                                ? "A password is already stored securely. Enter a new password only when replacing it."
                                : "Some providers require an app password rather than your normal account password."
                          }
                          autoComplete="new-password"
                      />
                      <TextField
                          label="From name"
                          value={form.smtpFromName}
                          onChange={(value) => updateSmtpField("smtpFromName", value)}
                          placeholder="Your store name"
                          autoComplete="organization"
                      />
                      <TextField
                          label="From email"
                          type="email"
                          value={form.smtpFromEmail}
                          onChange={(value) => updateSmtpField("smtpFromEmail", value)}
                          placeholder="support@example.com"
                          helpText="Your SMTP provider must allow this address to be used as the sender."
                          autoComplete="email"
                      />

                      {smtpStatus.lastError && (
                          <Banner tone="critical" title="SMTP connection failed">
                            <Text as="p">{smtpStatus.lastError}</Text>
                          </Banner>
                      )}

                      <InlineStack gap="300">
                        <Button
                            onClick={testSmtpConnection}
                            loading={smtpStatus.testing}
                            disabled={state.saving || hasUnsavedChanges}
                        >
                          Test connection
                        </Button>
                        {smtpStatus.hasPassword && (
                            <Button
                                tone="critical"
                                onClick={disconnectSmtp}
                                loading={smtpStatus.disconnecting}
                            >
                              Disconnect SMTP
                            </Button>
                        )}
                      </InlineStack>

                      {hasUnsavedChanges && (
                          <Text as="p" tone="subdued" variant="bodySm">
                            Save your changes before testing the connection.
                          </Text>
                      )}
                    </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd">Branding</Text>
                {proLocked && (
                    <Banner tone="info" title="Upgrade to Pro to unlock custom branding">
                      <Text as="p">
                        Make your branding unique by adding a custom colour to
                        customer emails and withdrawal communications.
                      </Text>
                    </Banner>
                )}
                <TextField
                    label="Brand name"
                    value={form.brandingName}
                    onChange={(value) => updateField("brandingName", value)}
                    helpText="Used in customer emails and withdrawal request communications."
                    autoComplete="organization"
                />
                <InlineStack gap="300" align="start">
                  <div style={{ flex: 1 }}>
                    <TextField
                        label="Primary brand color"
                        value={form.brandingPrimaryColor}
                        disabled={proLocked}
                        onChange={(value) => updateField("brandingPrimaryColor", value)}
                        autoComplete="off"
                        helpText="Example: #111827"
                    />
                  </div>
                  <div style={{ paddingTop: "28px" }}>
                    <input
                        type="color"
                        aria-label="Primary brand color picker"
                        value={form.brandingPrimaryColor}
                        disabled={proLocked}
                        onChange={(event) =>
                            updateField("brandingPrimaryColor", event.target.value)
                        }
                        style={{
                          width: 48,
                          height: 48,
                          border: "none",
                          background: "transparent",
                          cursor: proLocked ? "not-allowed" : "pointer",
                        }}
                    />
                  </div>
                </InlineStack>
                <Box padding="400" borderWidth="025" borderRadius="300" background="bg-surface-secondary">
                  <div
                      style={{
                        background: form.brandingPrimaryColor || "#0041c2",
                        padding: "16px",
                        borderRadius: "8px",
                        marginBottom: "16px",
                        opacity: proLocked ? 0.6 : 1,
                      }}
                  >
                    <h2 style={{ color: "#ffffff", margin: 0, fontSize: "20px" }}>
                      {form.brandingName || "Your Brand"}
                    </h2>
                  </div>
                  <Text as="p" variant="bodyMd">
                    This is how your email branding header will appear to customers.
                  </Text>
                </Box>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd">Email templates</Text>
                {proLocked && (
                    <Banner tone="info" title="Upgrade to Pro to unlock custom email templates">
                      <Text as="p">
                        Customize confirmation emails sent to customers with your own
                        messaging and HTML templates.
                      </Text>
                    </Banner>
                )}
                <Text variant="bodySm" tone="subdued">
                  Customize the confirmation email sent to customers. You can use
                  variables such as {"{{reference}}"}, {"{{shopName}}"}, {"{{customerEmail}}"} and {"{{customerName}}"}.
                </Text>
                <TextField
                    label="Email subject"
                    value={form.emailSubject || ""}
                    disabled={proLocked}
                    onChange={(value) => updateField("emailSubject", value)}
                    autoComplete="off"
                />
                <TextField
                    label="Email HTML"
                    multiline={6}
                    value={form.emailBody || ""}
                    disabled={proLocked}
                    onChange={(value) => updateField("emailBody", value)}
                    autoComplete="off"
                />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
  );
}
