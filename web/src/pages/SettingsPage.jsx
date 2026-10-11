import {
    Page,
    Layout,
    Card,
    Text,
    TextField,
    Banner,
    BlockStack,
    InlineStack,
    Box,
    ChoiceList,
    Select,
    Badge,
    Button,
    DataTable,
    SkeletonBodyText,
} from "@shopify/polaris";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { apiGet, apiSend } from "../api.js";
import AdminLanguageSelector from "../components/AdminLanguageSelector.jsx";

const LANGUAGE_OPTIONS = [
    ["English", "en"],
    ["Deutsch", "de"],
    ["Français", "fr"],
    ["Italiano", "it"],
    ["Español", "es"],
    ["Português", "pt"],
    ["Nederlands", "nl"],
    ["Polski", "pl"],
    ["Dansk", "da"],
    ["Svenska", "sv"],
    ["Suomi", "fi"],
    ["Čeština", "cs"],
    ["Slovenčina", "sk"],
    ["Slovenščina", "sl"],
    ["Hrvatski", "hr"],
    ["Magyar", "hu"],
    ["Română", "ro"],
    ["Български", "bg"],
    ["Ελληνικά", "el"],
    ["Eesti", "et"],
    ["Latviešu", "lv"],
    ["Lietuvių", "lt"],
    ["Gaeilge", "ga"],
    ["Malti", "mt"],
].map(([label, value]) => ({ label, value }));

const DEFAULT_LANGUAGES = ["en", "de"];

function parseEnabledLanguages(value) {
    if (Array.isArray(value)) return value;

    try {
        const parsed = JSON.parse(value || "[]");

        return Array.isArray(parsed) && parsed.length
            ? parsed
            : [...DEFAULT_LANGUAGES];
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
            shop?.emailDeliveryMethod ||
            (shop?.smtpEnabled ? "SMTP" : "GL6"),
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
    };
}

function cloneForm(form) {
    return {
        ...form,
        enabledLanguages: [...(form.enabledLanguages || [])],
    };
}

function normaliseForm(form) {
    return {
        ...form,
        enabledLanguages: [...(form.enabledLanguages || [])].sort(),
        withdrawalDays: String(form.withdrawalDays ?? ""),
        smtpPort: String(form.smtpPort ?? ""),
    };
}

function formsAreEqual(a, b) {
    return JSON.stringify(normaliseForm(a)) ===
        JSON.stringify(normaliseForm(b));
}

function statusLabel(value, t) {
    if (!value) {
        return t("settings.email.statuses.notConfigured");
    }

    const statusKeys = {
        verified: "verified",
        pending: "pending",
        not_started: "notStarted",
        failed: "failed",
        failure: "failure",
        temporary_failure: "temporaryFailure",
    };

    const status = String(value).toLowerCase();
    const key = statusKeys[status];

    return key
        ? t(`settings.email.statuses.${key}`)
        : String(value).replaceAll("_", " ");
}

function statusTone(value) {
    const status = String(value || "").toLowerCase();

    if (status === "verified") return "success";

    if (["failed", "failure"].includes(status)) {
        return "critical";
    }

    if (
        ["pending", "not_started", "temporary_failure"].includes(status)
    ) {
        return "attention";
    }

    return "info";
}

export default function SettingsPage({
                                         boot,
                                         onReload,
                                         onDirtyChange,
                                     }) {
    const { t } = useTranslation();

    const proLocked = !boot.isPro;

    const initialFormRef = useRef(createInitialForm(boot.shop));

    const [form, setForm] = useState(() =>
        cloneForm(initialFormRef.current)
    );

    const savedFormRef = useRef(
        cloneForm(initialFormRef.current)
    );

    const formElementRef = useRef(null);
    const dirtyBridgeRef = useRef(null);
    const dirtyBridgeReadyRef = useRef(false);

    const templateLoaded = true;

    const [state, setState] = useState({
        saving: false,
        error: "",
    });

    const [formVersion, setFormVersion] = useState(0);

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
        templateLoaded &&
        !formsAreEqual(form, savedFormRef.current);

    /*
     * Preserve Shopify's automatic save bar integration.
     * The hidden native input reflects controlled Polaris form changes.
     */
    useEffect(() => {
        if (!templateLoaded) return;

        const input = dirtyBridgeRef.current;
        if (!input) return;

        const nextValue = JSON.stringify(normaliseForm(form));

        if (!dirtyBridgeReadyRef.current) {
            input.defaultValue = nextValue;
            input.value = nextValue;
            dirtyBridgeReadyRef.current = true;
            return;
        }

        if (input.value !== nextValue) {
            input.value = nextValue;

            input.dispatchEvent(
                new Event("input", { bubbles: true })
            );
        }
    }, [form, templateLoaded]);

    useEffect(() => {
        onDirtyChange?.(hasUnsavedChanges);
    }, [hasUnsavedChanges, onDirtyChange]);

    useEffect(() => {
        return () => {
            onDirtyChange?.(false);
        };
    }, [onDirtyChange]);

    useEffect(() => {
        if (!boot.isPro || !boot.shop?.resendDomainId) {
            return;
        }

        refreshDomain();

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [boot.isPro, boot.shop?.resendDomainId]);

    function syncAutomaticSaveBarBaseline(nextForm) {
        const input = dirtyBridgeRef.current;

        if (!input) return;

        const nextValue = JSON.stringify(normaliseForm(nextForm));

        input.defaultValue = nextValue;
        input.value = nextValue;

        dirtyBridgeReadyRef.current = true;
    }

    function commitSavedForm(nextForm) {
        const saved = cloneForm(nextForm);

        setForm(saved);
        savedFormRef.current = cloneForm(saved);

        dirtyBridgeReadyRef.current = false;

        setFormVersion((current) => current + 1);

        return saved;
    }

    function handleFormReset(event) {
        event.preventDefault();

        const saved = cloneForm(savedFormRef.current);

        setForm(saved);
        dirtyBridgeReadyRef.current = false;

        setState({
            saving: false,
            error: "",
        });

        setFormVersion((current) => current + 1);
    }

    function handleFormSubmit(event) {
        event.preventDefault();
        void save();
    }

    function clearError() {
        setState((current) => ({
            ...current,
            error: "",
        }));
    }

    function blockSideActionWhenDirty(action) {
        if (!hasUnsavedChanges) return false;

        setState((current) => ({
            ...current,
            error: t("settings.errors.saveFirst", { action }),
        }));

        return true;
    }

    function updateField(key, value) {
        clearError();

        setForm((current) => ({
            ...current,
            [key]: value,
        }));
    }

    function updateSmtpField(key, value) {
        clearError();

        setForm((current) => ({
            ...current,
            [key]: value,
        }));

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
            if (!next.includes("en")) {
                next = ["en", ...next];
            }

            if (next.length > 2) {
                setState({
                    saving: false,
                    error: t("settings.errors.basicLanguageLimit"),
                });

                return;
            }
        }

        if (!next.length) {
            setState({
                saving: false,
                error: t("settings.errors.selectLanguage"),
            });

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
        if (state.saving) return;

        try {
            setState({
                saving: true,
                error: "",
            });

            const settingsResponse = await apiSend(
                "/admin/settings",
                "PATCH",
                {
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

                    ...(boot.isPro
                        ? {
                            smtpEnabled:
                                form.emailDeliveryMethod === "SMTP",
                            smtpHost: form.smtpHost,
                            smtpPort: Number(form.smtpPort),
                            smtpSecure: form.smtpSecure,
                            smtpUsername: form.smtpUsername,
                            smtpPassword:
                                form.smtpPassword || undefined,
                            smtpFromName: form.smtpFromName,
                            smtpFromEmail: form.smtpFromEmail,
                        }
                        : {}),
                }
            );

            const savedSmtp = boot.isPro
                ? settingsResponse.shop
                : null;

            commitSavedForm({
                ...form,
                smtpPassword: "",
            });

            if (savedSmtp) {
                setSmtpStatus((current) => ({
                    ...current,
                    hasPassword: Boolean(savedSmtp.smtpHasPassword),
                    verifiedAt: savedSmtp.smtpVerifiedAt || null,
                    lastError: savedSmtp.smtpLastError || null,
                }));
            }

            setState({
                saving: false,
                error: "",
            });

            await onReload?.({ silent: true });
        } catch (error) {
            setState({
                saving: false,
                error: error.message || t("settings.errors.save"),
            });
        }
    }

    async function testSmtpConnection() {
        if (hasUnsavedChanges) {
            setState((current) => ({
                ...current,
                error:
                    t("settings.email.errors.saveSmtpFirst"),
            }));

            return;
        }

        try {
            setSmtpStatus((current) => ({
                ...current,
                testing: true,
                lastError: null,
            }));

            const response = await apiSend(
                "/admin/smtp/test",
                "POST"
            );

            setSmtpStatus((current) => ({
                ...current,
                testing: false,
                hasPassword: Boolean(
                    response.settings?.smtpHasPassword
                ),
                verifiedAt:
                    response.settings?.smtpVerifiedAt || null,
                lastError: null,
            }));
        } catch (error) {
            const message =
                error.message || t("settings.email.errors.smtpFailed");

            setSmtpStatus((current) => ({
                ...current,
                testing: false,
                verifiedAt: null,
                lastError: message,
            }));

            setState((current) => ({
                ...current,
                error: message,
            }));
        }
    }

    async function disconnectSmtp() {
        if (blockSideActionWhenDirty("disconnect SMTP")) {
            return;
        }

        try {
            setSmtpStatus((current) => ({
                ...current,
                disconnecting: true,
            }));

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

            commitSavedForm(reset);

            setSmtpStatus({
                hasPassword: false,
                verifiedAt: null,
                lastError: null,
                testing: false,
                disconnecting: false,
            });

            setState({
                saving: false,
                error: "",
            });

            await onReload?.({ silent: true });
        } catch (error) {
            setSmtpStatus((current) => ({
                ...current,
                disconnecting: false,
            }));

            setState((current) => ({
                ...current,
                error:
                    error.message || t("settings.email.errors.disconnectSmtp"),
            }));
        }
    }

    async function createDomain() {
        if (
            blockSideActionWhenDirty("create a sending domain")
        ) {
            return;
        }

        const domainName = String(
            form.resendDomainName || ""
        ).trim();

        if (!domainName) {
            setState((current) => ({
                ...current,
                error: "Enter a domain or subdomain first.",
            }));

            return;
        }

        try {
            setDomainState((current) => ({
                ...current,
                creating: true,
                lastError: null,
            }));

            const response = await apiSend(
                "/admin/resend-domain",
                "POST",
                { domainName }
            );

            const settings = response.settings || {};

            const next = cloneForm({
                ...form,
                emailDeliveryMethod: "RESEND_DOMAIN",
                resendDomainName:
                    settings.resendDomainName || domainName,
            });

            commitSavedForm(next);

            setDomainState((current) => ({
                ...current,
                domainId:
                    settings.resendDomainId || current.domainId,
                status: settings.resendDomainStatus || null,
                records: response.records || [],
                creating: false,
                lastError: null,
            }));

            await onReload?.({ silent: true });
        } catch (error) {
            const message =
                error.message ||
                "Could not create the sending domain.";

            setDomainState((current) => ({
                ...current,
                creating: false,
                lastError: message,
            }));

            setState((current) => ({
                ...current,
                error: message,
            }));
        }
    }

    async function refreshDomain() {
        if (
            blockSideActionWhenDirty(
                "check the sending domain status"
            )
        ) {
            return;
        }

        try {
            setDomainState((current) => ({
                ...current,
                loading: true,
                lastError: null,
            }));

            const response = await apiGet(
                "/admin/resend-domain"
            );

            const settings = response.settings || {};

            setDomainState((current) => ({
                ...current,
                domainId:
                    settings.resendDomainId || current.domainId,
                status: settings.resendDomainStatus || null,
                records: response.records || [],
                loading: false,
                lastError:
                    settings.resendDomainLastError || null,
            }));

            commitSavedForm({
                ...form,
                resendDomainName:
                    settings.resendDomainName ||
                    form.resendDomainName,
                resendFromName:
                    settings.resendFromName ||
                    form.resendFromName,
                resendFromEmail:
                    settings.resendFromEmail ||
                    form.resendFromEmail,
            });
        } catch (error) {
            const message =
                error.message ||
                "Could not refresh the sending domain.";

            setDomainState((current) => ({
                ...current,
                loading: false,
                lastError: message,
            }));

            setState((current) => ({
                ...current,
                error: message,
            }));
        }
    }

    async function verifyDomain() {
        try {
            setDomainState((current) => ({
                ...current,
                verifying: true,
                lastError: null,
            }));

            const response = await apiSend(
                "/admin/resend-domain/verify",
                "POST"
            );

            setDomainState((current) => ({
                ...current,
                status:
                    response.settings?.resendDomainStatus ||
                    current.status,
                verifying: false,
                lastError: null,
            }));
        } catch (error) {
            const message =
                error.message ||
                "Could not start domain verification.";

            setDomainState((current) => ({
                ...current,
                verifying: false,
                lastError: message,
            }));

            setState((current) => ({
                ...current,
                error: message,
            }));
        }
    }

    async function saveDomainSender() {
        if (
            blockSideActionWhenDirty(
                "save the sender address"
            )
        ) {
            return;
        }

        if (
            String(domainState.status || "").toLowerCase() !==
            "verified"
        ) {
            setState((current) => ({
                ...current,
                error:
                    "Verify the sending domain before saving the sender address.",
            }));

            return;
        }

        try {
            setDomainState((current) => ({
                ...current,
                savingSender: true,
                lastError: null,
            }));

            const response = await apiSend(
                "/admin/resend-domain/sender",
                "PATCH",
                {
                    fromName: form.resendFromName,
                    fromEmail: form.resendFromEmail,
                }
            );

            const settings = response.settings || {};

            const next = cloneForm({
                ...form,
                emailDeliveryMethod: "RESEND_DOMAIN",
                resendFromName:
                    settings.resendFromName ||
                    form.resendFromName,
                resendFromEmail:
                    settings.resendFromEmail ||
                    form.resendFromEmail,
            });

            commitSavedForm(next);

            setDomainState((current) => ({
                ...current,
                savingSender: false,
                lastError: null,
            }));

            await onReload?.({ silent: true });
        } catch (error) {
            const message =
                error.message ||
                "Could not save the sender address.";

            setDomainState((current) => ({
                ...current,
                savingSender: false,
                lastError: message,
            }));

            setState((current) => ({
                ...current,
                error: message,
            }));
        }
    }

    async function removeDomain() {
        if (
            blockSideActionWhenDirty(
                "remove the sending domain"
            )
        ) {
            return;
        }

        try {
            setDomainState((current) => ({
                ...current,
                removing: true,
                lastError: null,
            }));

            await apiSend(
                "/admin/resend-domain",
                "DELETE"
            );

            const next = cloneForm({
                ...form,
                emailDeliveryMethod: "GL6",
                resendDomainName: "",
                resendFromName: "",
                resendFromEmail: "",
            });

            commitSavedForm(next);

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

            setState({
                saving: false,
                error: "",
            });

            await onReload?.({ silent: true });
        } catch (error) {
            const message =
                error.message ||
                "Could not remove the sending domain.";

            setDomainState((current) => ({
                ...current,
                removing: false,
                lastError: message,
            }));

            setState((current) => ({
                ...current,
                error: message,
            }));
        }
    }

    const domainVerified =
        String(domainState.status || "").toLowerCase() ===
        "verified";

    const dnsRows = (domainState.records || []).map(
        (record) => [
            record.type || "—",
            record.name || "—",
            record.value || "—",
            record.priority ?? "—",
            statusLabel(record.status, t),
        ]
    );

    if (!templateLoaded) {
        return (
            <Page title={t("settings.title")}>
                <Layout>
                    <Layout.Section>
                        <Card>
                            <BlockStack gap="400">
                                <Text variant="headingMd">
                                    {t("settings.loading")}
                                </Text>

                                <SkeletonBodyText lines={8} />
                            </BlockStack>
                        </Card>
                    </Layout.Section>
                </Layout>
            </Page>
        );
    }

    return (
        <Page title={t("settings.title")}>

            {/* App language selector stays outside the save-bar form. */}
            <div style={{ marginBottom: "16px" }}>
                <Layout>
                    <Layout.Section>
                        <AdminLanguageSelector
                            savedLanguage={boot.shop?.adminLocale}
                            onSaved={() =>
                                onReload?.({ silent: true })
                            }
                            disabled={
                                hasUnsavedChanges || state.saving
                            }
                        />
                    </Layout.Section>
                </Layout>
            </div>

            <form
                key={formVersion}
                ref={formElementRef}
                data-save-bar
                onSubmit={handleFormSubmit}
                onReset={handleFormReset}
            >
                <input
                    ref={dirtyBridgeRef}
                    type="hidden"
                    name="settingsState"
                    defaultValue=""
                />

                <Layout>

                    {/* Settings error */}
                    {state.error && (
                        <Layout.Section>
                            <Banner
                                tone="critical"
                                title={t("settings.saveFailed")}
                                onDismiss={clearError}
                            >
                                <Text as="p">
                                    {state.error}
                                </Text>
                            </Banner>
                        </Layout.Section>
                    )}

                    {/* General settings */}
                    <Layout.Section>
                        <Card>
                            <BlockStack gap="300">

                                <Text variant="headingMd">
                                    {t("settings.general.title")}
                                </Text>

                                {/* Customer-facing languages */}
                                <Card background="bg-surface-secondary">
                                    <BlockStack gap="400">

                                        <InlineStack
                                            align="space-between"
                                            blockAlign="center"
                                        >
                                            <BlockStack gap="100">

                                                <Text variant="headingMd">
                                                    {t(
                                                        "settings.general.customerLanguages"
                                                    )}
                                                </Text>

                                                <Text
                                                    as="p"
                                                    tone="subdued"
                                                >
                                                    {t(
                                                        "settings.general.customerLanguagesDescription"
                                                    )}
                                                </Text>

                                            </BlockStack>

                                            <Badge
                                                tone={
                                                    boot.isPro
                                                        ? "success"
                                                        : "info"
                                                }
                                            >
                                                {boot.isPro
                                                    ? t("settings.plans.pro")
                                                    : t("settings.plans.basic")}
                                            </Badge>

                                        </InlineStack>

                                        {!boot.isPro && (
                                            <Banner tone="info">
                                                <Text as="p">
                                                    {t(
                                                        "settings.general.basicLanguagesHelp"
                                                    )}
                                                </Text>
                                            </Banner>
                                        )}

                                        <ChoiceList
                                            title={t(
                                                "settings.general.availableLanguages"
                                            )}
                                            allowMultiple
                                            choices={LANGUAGE_OPTIONS.map(
                                                (language) => ({
                                                    ...language,
                                                    disabled:
                                                        !boot.isPro &&
                                                        language.value !== "en" &&
                                                        !form.enabledLanguages.includes(
                                                            language.value
                                                        ) &&
                                                        form.enabledLanguages.length >= 2,
                                                })
                                            )}
                                            selected={form.enabledLanguages}
                                            onChange={updateEnabledLanguages}
                                        />

                                        <Select
                                            label={t(
                                                "settings.general.defaultLanguage"
                                            )}
                                            helpText={t(
                                                "settings.general.defaultLanguageHelp"
                                            )}
                                            options={defaultLanguageOptions}
                                            value={form.locale}
                                            onChange={(value) =>
                                                updateField("locale", value)
                                            }
                                        />

                                    </BlockStack>
                                </Card>

                                {/* Withdrawal notification email */}
                                <TextField
                                    label={t(
                                        "settings.general.notificationEmail"
                                    )}
                                    value={form.merchantNotification}
                                    onChange={(value) =>
                                        updateField(
                                            "merchantNotification",
                                            value
                                        )
                                    }
                                    helpText={t(
                                        "settings.general.notificationEmailHelp"
                                    )}
                                    autoComplete="email"
                                />

                                {proLocked && (
                                    <Banner
                                        tone="info"
                                        title={t(
                                            "settings.general.upgradeTitle"
                                        )}
                                    >
                                        <Text as="p">
                                            {t(
                                                "settings.general.upgradeDescription"
                                            )}
                                        </Text>
                                    </Banner>
                                )}

                                {/* Legal page */}
                                <TextField
                                    label={t(
                                        "settings.general.legalPage"
                                    )}
                                    value={form.legalPageUrl}
                                    onChange={(value) =>
                                        updateField(
                                            "legalPageUrl",
                                            value
                                        )
                                    }
                                    autoComplete="url"
                                />

                                {/* Privacy page */}
                                <TextField
                                    label={t(
                                        "settings.general.privacyPage"
                                    )}
                                    value={form.privacyPageUrl}
                                    onChange={(value) =>
                                        updateField(
                                            "privacyPageUrl",
                                            value
                                        )
                                    }
                                    autoComplete="url"
                                />

                                {/* Support email */}
                                <TextField
                                    label={t(
                                        "settings.general.supportEmail"
                                    )}
                                    value={form.supportEmail}
                                    onChange={(value) =>
                                        updateField(
                                            "supportEmail",
                                            value
                                        )
                                    }
                                    helpText={t(
                                        "settings.general.supportEmailHelp"
                                    )}
                                    autoComplete="email"
                                />

                                {proLocked && (
                                    <Text
                                        variant="bodySm"
                                        tone="subdued"
                                    >
                                        {t(
                                            "settings.general.basicPeriod"
                                        )}
                                    </Text>
                                )}

                                {/* Withdrawal period */}
                                <TextField
                                    label={t(
                                        "settings.general.withdrawalPeriod"
                                    )}
                                    helpText={
                                        proLocked
                                            ? t(
                                                "settings.general.periodBasicHelp"
                                            )
                                            : t(
                                                "settings.general.periodProHelp"
                                            )
                                    }
                                    type="number"
                                    value={String(
                                        form.withdrawalDays
                                    )}
                                    disabled={proLocked}
                                    onChange={(value) =>
                                        updateField(
                                            "withdrawalDays",
                                            value
                                        )
                                    }
                                    autoComplete="off"
                                />

                            </BlockStack>
                        </Card>
                    </Layout.Section>

                    {/* Email delivery - translation in Step 9E */}

                    <Layout.Section>
                        <Card>
                            <BlockStack gap="400">
                                <InlineStack
                                    align="space-between"
                                    blockAlign="center"
                                >
                                    <BlockStack gap="100">
                                        <Text variant="headingMd">
                                            {t("settings.email.title")}
                                        </Text>
                                        <Text as="p" tone="subdued">
                                            {t("settings.email.description")}
                                        </Text>
                                    </BlockStack>

                                    {!boot.isPro ? (
                                        <Badge tone="info">
                                            {t("settings.plans.basic")}
                                        </Badge>
                                    ) : form.emailDeliveryMethod === "RESEND_DOMAIN" ? (
                                        <Badge tone={statusTone(domainState.status)}>
                                            {statusLabel(domainState.status, t)}
                                        </Badge>
                                    ) : form.emailDeliveryMethod === "SMTP" &&
                                    smtpStatus.verifiedAt ? (
                                        <Badge tone="success">
                                            {t("settings.email.connected")}
                                        </Badge>
                                    ) : form.emailDeliveryMethod === "SMTP" &&
                                    smtpStatus.lastError ? (
                                        <Badge tone="critical">
                                            {t("settings.email.connectionFailed")}
                                        </Badge>
                                    ) : form.emailDeliveryMethod === "SMTP" ? (
                                        <Badge tone="attention">
                                            {t("settings.email.requiresTesting")}
                                        </Badge>
                                    ) : (
                                        <Badge tone="success">
                                            {t("settings.email.managed")}
                                        </Badge>
                                    )}
                                </InlineStack>

                                <ChoiceList
                                    title={t("settings.email.deliveryMethod")}
                                    choices={[
                                        {
                                            label: t("settings.email.managedOption"),
                                            value: "GL6",
                                            helpText: t("settings.email.managedHelp"),
                                        },
                                        {
                                            label: t("settings.email.smtpOption"),
                                            value: "SMTP",
                                            helpText: t("settings.email.smtpOptionHelp"),
                                            disabled: !boot.isPro,
                                        },
                                    ]}
                                    selected={[form.emailDeliveryMethod]}
                                    onChange={(selected) =>
                                        updateField("emailDeliveryMethod", selected[0])
                                    }
                                />

                                {!boot.isPro && (
                                    <Banner
                                        tone="info"
                                        title={t("settings.email.proTitle")}
                                    >
                                        <Text as="p">
                                            {t("settings.email.proDescription")}
                                        </Text>
                                    </Banner>
                                )}

                                {/*{boot.isPro &&*/}
                                {/*    form.emailDeliveryMethod === "RESEND_DOMAIN" && (*/}
                                {/*        <BlockStack gap="300">*/}
                                {/*            <Banner tone="info">*/}
                                {/*                <Text as="p">*/}
                                {/*                    {t("settings.email.domain.intro")}*/}
                                {/*                </Text>*/}
                                {/*            </Banner>*/}

                                {/*            {!domainState.domainId ? (*/}
                                {/*                <>*/}
                                {/*                    <TextField*/}
                                {/*                        label={t("settings.email.domain.label")}*/}
                                {/*                        value={form.resendDomainName}*/}
                                {/*                        onChange={(value) =>*/}
                                {/*                            updateField("resendDomainName", value)*/}
                                {/*                        }*/}
                                {/*                        placeholder="withdrawals.example.com"*/}
                                {/*                        helpText={t("settings.email.domain.help")}*/}
                                {/*                        autoComplete="off"*/}
                                {/*                    />*/}

                                {/*                    <Button*/}
                                {/*                        variant="primary"*/}
                                {/*                        onClick={createDomain}*/}
                                {/*                        loading={domainState.creating}*/}
                                {/*                        disabled={*/}
                                {/*                            !String(form.resendDomainName || "").trim()*/}
                                {/*                        }*/}
                                {/*                    >*/}
                                {/*                        {t("settings.email.domain.add")}*/}
                                {/*                    </Button>*/}
                                {/*                </>*/}
                                {/*            ) : (*/}
                                {/*                <>*/}
                                {/*                    <InlineStack*/}
                                {/*                        align="space-between"*/}
                                {/*                        blockAlign="center"*/}
                                {/*                    >*/}
                                {/*                        <BlockStack gap="100">*/}
                                {/*                            <Text variant="headingSm">*/}
                                {/*                                {form.resendDomainName}*/}
                                {/*                            </Text>*/}

                                {/*                            <Text*/}
                                {/*                                as="p"*/}
                                {/*                                tone="subdued"*/}
                                {/*                                variant="bodySm"*/}
                                {/*                            >*/}
                                {/*                                {t("settings.email.domain.recordsHelp")}*/}
                                {/*                            </Text>*/}
                                {/*                        </BlockStack>*/}

                                {/*                        <Badge tone={statusTone(domainState.status)}>*/}
                                {/*                            {statusLabel(domainState.status, t)}*/}
                                {/*                        </Badge>*/}
                                {/*                    </InlineStack>*/}

                                {/*                    {dnsRows.length > 0 && (*/}
                                {/*                        <Box*/}
                                {/*                            borderWidth="025"*/}
                                {/*                            borderRadius="300"*/}
                                {/*                            overflowX="scroll"*/}
                                {/*                        >*/}
                                {/*                            <DataTable*/}
                                {/*                                columnContentTypes={[*/}
                                {/*                                    "text",*/}
                                {/*                                    "text",*/}
                                {/*                                    "text",*/}
                                {/*                                    "numeric",*/}
                                {/*                                    "text",*/}
                                {/*                                ]}*/}
                                {/*                                headings={[*/}
                                {/*                                    t("settings.email.domain.columns.type"),*/}
                                {/*                                    t("settings.email.domain.columns.name"),*/}
                                {/*                                    t("settings.email.domain.columns.value"),*/}
                                {/*                                    t("settings.email.domain.columns.priority"),*/}
                                {/*                                    t("settings.email.domain.columns.status"),*/}
                                {/*                                ]}*/}
                                {/*                                rows={dnsRows}*/}
                                {/*                            />*/}
                                {/*                        </Box>*/}
                                {/*                    )}*/}

                                {/*                    {domainState.lastError && (*/}
                                {/*                        <Banner*/}
                                {/*                            tone="critical"*/}
                                {/*                            title={t("settings.email.domain.issue")}*/}
                                {/*                        >*/}
                                {/*                            <Text as="p">*/}
                                {/*                                {domainState.lastError}*/}
                                {/*                            </Text>*/}
                                {/*                        </Banner>*/}
                                {/*                    )}*/}

                                {/*                    <InlineStack gap="300">*/}
                                {/*                        <Button*/}
                                {/*                            onClick={refreshDomain}*/}
                                {/*                            loading={domainState.loading}*/}
                                {/*                        >*/}
                                {/*                            {t("settings.email.domain.check")}*/}
                                {/*                        </Button>*/}

                                {/*                        {!domainVerified && (*/}
                                {/*                            <Button*/}
                                {/*                                variant="primary"*/}
                                {/*                                onClick={verifyDomain}*/}
                                {/*                                loading={domainState.verifying}*/}
                                {/*                            >*/}
                                {/*                                {t("settings.email.domain.verify")}*/}
                                {/*                            </Button>*/}
                                {/*                        )}*/}

                                {/*                        <Button*/}
                                {/*                            tone="critical"*/}
                                {/*                            onClick={removeDomain}*/}
                                {/*                            loading={domainState.removing}*/}
                                {/*                        >*/}
                                {/*                            {t("settings.email.domain.remove")}*/}
                                {/*                        </Button>*/}
                                {/*                    </InlineStack>*/}

                                {/*                    {domainVerified && (*/}
                                {/*                        <BlockStack gap="300">*/}
                                {/*                            <Banner*/}
                                {/*                                tone="success"*/}
                                {/*                                title={t(*/}
                                {/*                                    "settings.email.domain.verifiedTitle"*/}
                                {/*                                )}*/}
                                {/*                            >*/}
                                {/*                                <Text as="p">*/}
                                {/*                                    {t(*/}
                                {/*                                        "settings.email.domain.verifiedDescription"*/}
                                {/*                                    )}*/}
                                {/*                                </Text>*/}
                                {/*                            </Banner>*/}

                                {/*                            <TextField*/}
                                {/*                                label={t("settings.email.domain.fromName")}*/}
                                {/*                                value={form.resendFromName}*/}
                                {/*                                onChange={(value) =>*/}
                                {/*                                    updateField("resendFromName", value)*/}
                                {/*                                }*/}
                                {/*                                placeholder={t(*/}
                                {/*                                    "settings.email.domain.storePlaceholder"*/}
                                {/*                                )}*/}
                                {/*                                autoComplete="organization"*/}
                                {/*                            />*/}

                                {/*                            <TextField*/}
                                {/*                                label={t("settings.email.domain.fromEmail")}*/}
                                {/*                                type="email"*/}
                                {/*                                value={form.resendFromEmail}*/}
                                {/*                                onChange={(value) =>*/}
                                {/*                                    updateField("resendFromEmail", value)*/}
                                {/*                                }*/}
                                {/*                                placeholder={`withdrawals@${form.resendDomainName}`}*/}
                                {/*                                helpText={t(*/}
                                {/*                                    "settings.email.domain.emailHelp",*/}
                                {/*                                    { domain: form.resendDomainName }*/}
                                {/*                                )}*/}
                                {/*                                autoComplete="email"*/}
                                {/*                            />*/}

                                {/*                            <Button*/}
                                {/*                                variant="primary"*/}
                                {/*                                onClick={saveDomainSender}*/}
                                {/*                                loading={domainState.savingSender}*/}
                                {/*                                disabled={*/}
                                {/*                                    !String(form.resendFromEmail || "").trim()*/}
                                {/*                                }*/}
                                {/*                            >*/}
                                {/*                                {t("settings.email.domain.saveSender")}*/}
                                {/*                            </Button>*/}
                                {/*                        </BlockStack>*/}
                                {/*                    )}*/}
                                {/*                </>*/}
                                {/*            )}*/}
                                {/*        </BlockStack>*/}
                                {/*    )}*/}

                                {boot.isPro &&
                                    form.emailDeliveryMethod === "SMTP" && (
                                        <BlockStack gap="300">
                                            <Banner tone="info">
                                                <Text as="p">
                                                    {t("settings.email.smtp.intro")}
                                                </Text>
                                            </Banner>

                                            <TextField
                                                label={t("settings.email.smtp.host")}
                                                value={form.smtpHost}
                                                onChange={(value) =>
                                                    updateSmtpField("smtpHost", value)
                                                }
                                                placeholder="smtp.example.com"
                                                autoComplete="off"
                                            />

                                            <TextField
                                                label={t("settings.email.smtp.port")}
                                                type="number"
                                                value={form.smtpPort}
                                                onChange={(value) =>
                                                    updateSmtpField("smtpPort", value)
                                                }
                                                helpText={t("settings.email.smtp.portHelp")}
                                                autoComplete="off"
                                            />

                                            <Select
                                                label={t("settings.email.smtp.security")}
                                                options={[
                                                    {
                                                        label: t("settings.email.smtp.starttls"),
                                                        value: "starttls",
                                                    },
                                                    {
                                                        label: t("settings.email.smtp.ssl"),
                                                        value: "ssl",
                                                    },
                                                ]}
                                                value={form.smtpSecure ? "ssl" : "starttls"}
                                                onChange={(value) =>
                                                    updateSmtpField(
                                                        "smtpSecure",
                                                        value === "ssl"
                                                    )
                                                }
                                            />

                                            <TextField
                                                label={t("settings.email.smtp.username")}
                                                value={form.smtpUsername}
                                                onChange={(value) =>
                                                    updateSmtpField("smtpUsername", value)
                                                }
                                                helpText={t("settings.email.smtp.usernameHelp")}
                                                autoComplete="off"
                                            />

                                            <TextField
                                                label={t("settings.email.smtp.password")}
                                                type="password"
                                                value={form.smtpPassword}
                                                onChange={(value) =>
                                                    updateSmtpField("smtpPassword", value)
                                                }
                                                placeholder={
                                                    smtpStatus.hasPassword
                                                        ? t(
                                                            "settings.email.smtp.savedPasswordPlaceholder"
                                                        )
                                                        : t(
                                                            "settings.email.smtp.newPasswordPlaceholder"
                                                        )
                                                }
                                                helpText={
                                                    smtpStatus.hasPassword
                                                        ? t("settings.email.smtp.savedPasswordHelp")
                                                        : t("settings.email.smtp.newPasswordHelp")
                                                }
                                                autoComplete="new-password"
                                            />

                                            <TextField
                                                label={t("settings.email.smtp.fromName")}
                                                value={form.smtpFromName}
                                                onChange={(value) =>
                                                    updateSmtpField("smtpFromName", value)
                                                }
                                                placeholder={t(
                                                    "settings.email.smtp.storePlaceholder"
                                                )}
                                                autoComplete="organization"
                                            />

                                            <TextField
                                                label={t("settings.email.smtp.fromEmail")}
                                                type="email"
                                                value={form.smtpFromEmail}
                                                onChange={(value) =>
                                                    updateSmtpField("smtpFromEmail", value)
                                                }
                                                placeholder="support@example.com"
                                                helpText={t("settings.email.smtp.fromEmailHelp")}
                                                autoComplete="email"
                                            />

                                            {smtpStatus.lastError && (
                                                <Banner
                                                    tone="critical"
                                                    title={t(
                                                        "settings.email.smtp.connectionFailed"
                                                    )}
                                                >
                                                    <Text as="p">
                                                        {smtpStatus.lastError}
                                                    </Text>
                                                </Banner>
                                            )}

                                            <InlineStack gap="300">
                                                <Button
                                                    onClick={testSmtpConnection}
                                                    loading={smtpStatus.testing}
                                                    disabled={
                                                        state.saving || hasUnsavedChanges
                                                    }
                                                >
                                                    {t("settings.email.smtp.test")}
                                                </Button>

                                                {smtpStatus.hasPassword && (
                                                    <Button
                                                        tone="critical"
                                                        onClick={disconnectSmtp}
                                                        loading={smtpStatus.disconnecting}
                                                    >
                                                        {t("settings.email.smtp.disconnect")}
                                                    </Button>
                                                )}
                                            </InlineStack>

                                            {hasUnsavedChanges && (
                                                <Text
                                                    as="p"
                                                    tone="subdued"
                                                    variant="bodySm"
                                                >
                                                    {t("settings.email.smtp.saveBeforeTest")}
                                                </Text>
                                            )}
                                        </BlockStack>
                                    )}
                            </BlockStack>
                        </Card>
                    </Layout.Section>
                </Layout>
            </form>
        </Page>
    );
}