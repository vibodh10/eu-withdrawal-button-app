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
} from "@shopify/polaris";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ContextualSaveBar,
} from "@shopify/app-bridge/actions";

import { apiGet, apiSend } from "../api.js";
import { app } from "../appBridge.js";

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

const DEFAULT_LANGUAGES = ["en", "de"];

function parseEnabledLanguages(value) {
  if (Array.isArray(value)) {
    return value;
  }

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
    enabledLanguages: parseEnabledLanguages(
        shop?.enabledLanguages
    ),
    brandingPrimaryColor:
        shop?.brandingPrimaryColor || "#111827",
    merchantNotification:
        shop?.merchantNotification || "",
    legalPageUrl:
        shop?.legalPageUrl || "",
    privacyPageUrl:
        shop?.privacyPageUrl || "",
    supportEmail:
        shop?.supportEmail || "",
    withdrawalDays:
        shop?.withdrawalDays || 14,
    emailSubject: "",
    emailBody: "",
  };
}

function cloneForm(form) {
  return {
    ...form,
    enabledLanguages: [
      ...(form.enabledLanguages || []),
    ],
  };
}

function normaliseFormForComparison(form) {
  return {
    ...form,
    enabledLanguages: [
      ...(form.enabledLanguages || []),
    ].sort(),
    withdrawalDays: String(
        form.withdrawalDays || 14
    ),
    emailSubject:
        form.emailSubject || "",
    emailBody:
        form.emailBody || "",
  };
}

function formsAreEqual(first, second) {
  return (
      JSON.stringify(
          normaliseFormForComparison(first)
      ) ===
      JSON.stringify(
          normaliseFormForComparison(second)
      )
  );
}

export default function SettingsPage({
                                       boot,
                                       onReload,
                                       onDirtyChange,
                                     }) {
  const proLocked = !boot.isPro;

  /*
   * Keep initial values stable for the lifetime
   * of this mounted Settings page.
   */
  const initialFormRef = useRef(
      createInitialForm(boot.shop)
  );

  const [form, setForm] = useState(() =>
      cloneForm(initialFormRef.current)
  );

  const savedFormRef = useRef(
      cloneForm(initialFormRef.current)
  );

  const contextualSaveBarRef = useRef(null);
  const saveHandlerRef = useRef(null);
  const discardHandlerRef = useRef(null);

  const [templateLoaded, setTemplateLoaded] =
      useState(false);

  const [state, setState] = useState({
    saving: false,
    error: "",
  });

  const hasUnsavedChanges =
      templateLoaded &&
      !formsAreEqual(form, savedFormRef.current);

  /*
   * Create the genuine Shopify Admin
   * Contextual Save Bar once.
   */
  useEffect(() => {
    if (!templateLoaded || contextualSaveBarRef.current) {
      return;
    }

    const saveBar = ContextualSaveBar.create(app, {
      saveAction: {
        disabled: false,
        loading: false,
      },
      discardAction: {
        disabled: false,
      },
    });

    contextualSaveBarRef.current = saveBar;

    // Ensure it starts hidden.
    saveBar.dispatch(ContextualSaveBar.Action.HIDE);

    const unsubscribeSave = saveBar.subscribe(
        ContextualSaveBar.Action.SAVE,
        () => {
          saveHandlerRef.current?.();
        }
    );

    const unsubscribeDiscard = saveBar.subscribe(
        ContextualSaveBar.Action.DISCARD,
        () => {
          discardHandlerRef.current?.();
        }
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

    return () => {
      onDirtyChange?.(false);
    };
  }, [hasUnsavedChanges, onDirtyChange]);

  /*
   * Load the confirmation email template once.
   */
  useEffect(() => {
    let cancelled = false;

    async function loadTemplate() {
      try {
        const response = await apiGet(
            "/admin/email-templates"
        );

        const template =
            response.templates?.find(
                (item) =>
                    item.code === "CONFIRMATION"
            );

        if (cancelled) {
          return;
        }

        const loadedForm = {
          ...initialFormRef.current,
          emailSubject:
              template?.subject || "",
          emailBody:
              template?.bodyHtml || "",
        };

        const clonedForm =
            cloneForm(loadedForm);

        setForm(clonedForm);
        savedFormRef.current =
            cloneForm(clonedForm);
      } catch (error) {
        console.error(
            "Could not load email template:",
            error
        );

        if (!cancelled) {
          setState({
            saving: false,
            error:
                "Could not load the email template.",
          });
        }
      } finally {
        if (!cancelled) {
          setTemplateLoaded(true);
        }
      }
    }

    loadTemplate();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const saveBar = contextualSaveBarRef.current;

    if (!saveBar || !templateLoaded) {
      return;
    }

    /*
     * When the form is clean, hide the bar and stop.
     * Do not call saveBar.set() after hiding it.
     */
    if (!hasUnsavedChanges) {
      saveBar.dispatch(
          ContextualSaveBar.Action.HIDE
      );

      return;
    }

    /*
     * Only update button properties while the bar
     * genuinely represents unsaved changes.
     */
    saveBar.set({
      saveAction: {
        disabled: state.saving,
        loading: state.saving,
      },
      discardAction: {
        disabled: state.saving,
      },
    });

    saveBar.dispatch(
        ContextualSaveBar.Action.SHOW
    );
  }, [
    hasUnsavedChanges,
    state.saving,
    templateLoaded,
  ]);

  function clearError() {
    setState((current) => ({
      ...current,
      error: "",
    }));
  }

  function updateField(key, value) {
    clearError();

    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function updateEnabledLanguages(selected) {
    clearError();

    let nextLanguages = [
      ...new Set(selected),
    ];

    if (!boot.isPro) {
      /*
       * English is compulsory on Basic.
       */
      if (!nextLanguages.includes("en")) {
        nextLanguages = [
          "en",
          ...nextLanguages,
        ];
      }

      if (nextLanguages.length > 2) {
        setState({
          saving: false,
          error:
              "The Basic plan includes English plus 1 additional language.",
        });

        return;
      }
    }

    if (nextLanguages.length === 0) {
      setState({
        saving: false,
        error:
            "Select at least one language.",
      });

      return;
    }

    setForm((current) => {
      const nextDefaultLanguage =
          nextLanguages.includes(current.locale)
              ? current.locale
              : nextLanguages.includes("en")
                  ? "en"
                  : nextLanguages[0];

      return {
        ...current,
        enabledLanguages:
        nextLanguages,
        locale:
        nextDefaultLanguage,
      };
    });
  }

  const defaultLanguageOptions =
      useMemo(
          () =>
              LANGUAGE_OPTIONS.filter(
                  (language) =>
                      form.enabledLanguages.includes(
                          language.value
                      )
              ),
          [form.enabledLanguages]
      );

  async function save() {
    if (
        !hasUnsavedChanges ||
        state.saving
    ) {
      return;
    }

    try {
      setState({
        saving: true,
        error: "",
      });

      await apiSend(
          "/admin/settings",
          "PATCH",
          {
            brandingName:
            form.brandingName,
            locale:
            form.locale,
            enabledLanguages:
            form.enabledLanguages,
            brandingPrimaryColor:
            form.brandingPrimaryColor,
            merchantNotification:
            form.merchantNotification,
            legalPageUrl:
            form.legalPageUrl,
            privacyPageUrl:
            form.privacyPageUrl,
            supportEmail:
            form.supportEmail,
            withdrawalDays:
            form.withdrawalDays,
          }
      );

      /*
       * Email template customization
       * is available only on Pro.
       */
      if (boot.isPro) {
        await apiSend(
            "/admin/email-templates/CONFIRMATION",
            "PATCH",
            {
              subject:
                  form.emailSubject || "",
              bodyHtml:
                  form.emailBody || "",
            }
        );
      }

      savedFormRef.current = cloneForm(form);

      /*
       * Trigger a render. The unified CSB effect will detect
       * that the current form now equals the saved form and hide it.
       */
      setState({
        saving: false,
        error: "",
      });

      onDirtyChange?.(false);

      await onReload?.({
        silent: true,
      });
    } catch (error) {
      console.error(
          "Settings save failed:",
          error
      );

      setState({
        saving: false,
        error:
            error.message ||
            "Could not save settings.",
      });

      contextualSaveBarRef.current?.dispatch(
          ContextualSaveBar.Action.SHOW
      );
    }
  }

  function discardChanges() {
    setForm(
        cloneForm(savedFormRef.current)
    );

    setState({
      saving: false,
      error: "",
    });

    onDirtyChange?.(false);
  }

  /*
   * Keep CSB subscriptions pointed at the
   * latest render's save/discard functions.
   */
  saveHandlerRef.current = save;
  discardHandlerRef.current =
      discardChanges;

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
                  <Text as="p">
                    {state.error}
                  </Text>
                </Banner>
              </Layout.Section>
          )}

          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd">
                  General settings
                </Text>

                <Card background="bg-surface-secondary">
                  <BlockStack gap="400">
                    <InlineStack
                        align="space-between"
                        blockAlign="center"
                    >
                      <BlockStack gap="100">
                        <Text variant="headingMd">
                          Customer form languages
                        </Text>

                        <Text
                            as="p"
                            tone="subdued"
                        >
                          Choose the languages
                          customers can use in the
                          withdrawal form.
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
                            ? "Pro"
                            : "Basic"}
                      </Badge>
                    </InlineStack>

                    {!boot.isPro && (
                        <Banner tone="info">
                          <Text as="p">
                            The Basic plan includes
                            English plus 1 additional
                            language. Upgrade to Pro
                            to enable all supported
                            languages.
                          </Text>
                        </Banner>
                    )}

                    <ChoiceList
                        title="Languages available to customers"
                        allowMultiple
                        choices={LANGUAGE_OPTIONS.map(
                            (language) => ({
                              ...language,
                              disabled:
                                  !boot.isPro &&
                                  language.value !==
                                  "en" &&
                                  !form.enabledLanguages.includes(
                                      language.value
                                  ) &&
                                  form.enabledLanguages
                                      .length >= 2,
                            })
                        )}
                        selected={
                          form.enabledLanguages
                        }
                        onChange={
                          updateEnabledLanguages
                        }
                    />

                    <Select
                        label="Default language"
                        helpText="The form opens in this language. Customers can switch to another enabled language."
                        options={
                          defaultLanguageOptions
                        }
                        value={form.locale}
                        onChange={(value) =>
                            updateField(
                                "locale",
                                value
                            )
                        }
                    />
                  </BlockStack>
                </Card>

                <TextField
                    label="Merchant notification email"
                    value={
                      form.merchantNotification
                    }
                    onChange={(value) =>
                        updateField(
                            "merchantNotification",
                            value
                        )
                    }
                    autoComplete="email"
                />

                {proLocked && (
                    <Banner
                        tone="info"
                        title="Upgrade to Pro to unlock advanced settings"
                    >
                      <Text as="p">
                        Adjustable withdrawal
                        periods are available on
                        Pro.
                      </Text>
                    </Banner>
                )}

                <TextField
                    label="Legal page URL"
                    value={form.legalPageUrl}
                    onChange={(value) =>
                        updateField(
                            "legalPageUrl",
                            value
                        )
                    }
                    autoComplete="url"
                />

                <TextField
                    label="Privacy page URL"
                    value={form.privacyPageUrl}
                    onChange={(value) =>
                        updateField(
                            "privacyPageUrl",
                            value
                        )
                    }
                    autoComplete="url"
                />

                <TextField
                    label="Support email"
                    value={form.supportEmail}
                    onChange={(value) =>
                        updateField(
                            "supportEmail",
                            value
                        )
                    }
                    autoComplete="email"
                />

                {proLocked && (
                    <Text
                        variant="bodySm"
                        tone="subdued"
                    >
                      The Basic plan uses a
                      standard 14-day withdrawal
                      baseline. Automatic
                      validation is not enforced.
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

          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd">
                  Branding
                </Text>

                {proLocked && (
                    <Banner
                        tone="info"
                        title="Upgrade to Pro to unlock custom branding"
                    >
                      <Text as="p">
                        Make your branding unique
                        by adding a custom colour to
                        customer emails and
                        withdrawal communications.
                      </Text>
                    </Banner>
                )}

                <TextField
                    label="Brand name"
                    value={form.brandingName}
                    onChange={(value) =>
                        updateField(
                            "brandingName",
                            value
                        )
                    }
                    helpText="Used in customer emails and withdrawal request communications."
                    autoComplete="organization"
                />

                <InlineStack
                    gap="300"
                    align="start"
                >
                  <div style={{ flex: 1 }}>
                    <TextField
                        label="Primary brand color"
                        value={
                          form.brandingPrimaryColor
                        }
                        disabled={proLocked}
                        onChange={(value) =>
                            updateField(
                                "brandingPrimaryColor",
                                value
                            )
                        }
                        autoComplete="off"
                        helpText="Example: #111827"
                    />
                  </div>

                  <div
                      style={{
                        paddingTop: "28px",
                      }}
                  >
                    <input
                        type="color"
                        aria-label="Primary brand color picker"
                        value={
                          form.brandingPrimaryColor
                        }
                        disabled={proLocked}
                        onChange={(event) =>
                            updateField(
                                "brandingPrimaryColor",
                                event.target.value
                            )
                        }
                        style={{
                          width: 48,
                          height: 48,
                          border: "none",
                          background:
                              "transparent",
                          cursor: proLocked
                              ? "not-allowed"
                              : "pointer",
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
                        background:
                            form.brandingPrimaryColor ||
                            "#0041c2",
                        padding: "16px",
                        borderRadius: "8px",
                        marginBottom: "16px",
                        opacity: proLocked
                            ? 0.6
                            : 1,
                      }}
                  >
                    <h2
                        style={{
                          color: "#ffffff",
                          margin: 0,
                          fontSize: "20px",
                        }}
                    >
                      {form.brandingName ||
                          "Your Brand"}
                    </h2>
                  </div>

                  <Text
                      as="p"
                      variant="bodyMd"
                  >
                    This is how your email
                    branding header will appear
                    to customers.
                  </Text>
                </Box>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd">
                  Email templates
                </Text>

                {proLocked && (
                    <Banner
                        tone="info"
                        title="Upgrade to Pro to unlock custom email templates"
                    >
                      <Text as="p">
                        Customize confirmation
                        emails sent to customers
                        with your own messaging and
                        HTML templates.
                      </Text>
                    </Banner>
                )}

                <Text
                    variant="bodySm"
                    tone="subdued"
                >
                  Customize the confirmation
                  email sent to customers. You
                  can use variables such as{" "}
                  {"{{reference}}"},{" "}
                  {"{{shopName}}"},{" "}
                  {"{{customerEmail}}"} and{" "}
                  {"{{customerName}}"}.
                </Text>

                <TextField
                    label="Email subject"
                    value={
                        form.emailSubject || ""
                    }
                    disabled={proLocked}
                    onChange={(value) =>
                        updateField(
                            "emailSubject",
                            value
                        )
                    }
                    autoComplete="off"
                />

                <TextField
                    label="Email HTML"
                    multiline={6}
                    value={form.emailBody || ""}
                    disabled={proLocked}
                    onChange={(value) =>
                        updateField(
                            "emailBody",
                            value
                        )
                    }
                    autoComplete="off"
                />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
  );
}