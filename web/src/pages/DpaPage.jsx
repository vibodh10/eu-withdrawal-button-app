
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
    Page,
    Card,
    Text,
    Button,
    BlockStack,
    InlineStack,
    Link,
    Checkbox,
    Select,
    Banner,
} from "@shopify/polaris";

import { apiSend } from "../api";
import { normalizeAdminLanguage } from "../i18n";

import { EU_LANGUAGE_OPTIONS as LANGUAGE_OPTIONS } from "../../../shared/euLanguages.js";

export default function DpaPage({ onAccepted }) {
    const { i18n } = useTranslation();

    const [step, setStep] = useState(1);

    const [language, setLanguage] = useState(() =>
        normalizeAdminLanguage(i18n.resolvedLanguage || i18n.language)
    );

    const translate = i18n.getFixedT(language);

    const [checked, setChecked] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    function changeLanguage(value) {
        const nextLanguage = normalizeAdminLanguage(value);

        setLanguage(nextLanguage);
        setError("");
        setChecked(false);

        void i18n.changeLanguage(nextLanguage);
    }

    function goNext() {
        setError("");
        setStep(2);
    }

    function goBack() {
        if (loading) return;

        setChecked(false);
        setError("");
        setStep(1);
    }

    async function acceptDpa() {
        if (!checked || loading) return;

        setLoading(true);
        setError("");

        try {
            await apiSend("/admin/dpa/accept", "POST", {
                adminLocale: language,
            });

            await onAccepted?.({ silent: true });
        } catch (err) {
            console.error("DPA acceptance failed:", err);
            setError(translate("onboarding.error"));
        } finally {
            setLoading(false);
        }
    }

    return (
        <Page
            title={
                step === 1
                    ? translate("onboarding.languageTitle").replace(/^1\.\s*/, "")
                    : translate("onboarding.dpaTitle").replace(/^2\.\s*/, "")
            }
            subtitle={
                step === 1
                    ? translate("onboarding.step1")
                    : translate("onboarding.step2")
            }
        >
            <BlockStack gap="400">
                {step === 1 && (
                    <Card>
                        <BlockStack gap="400">
                            <Text as="p">
                                {translate("onboarding.languageDescription")}
                            </Text>

                            <Select
                                label={translate("onboarding.languageLabel")}
                                options={LANGUAGE_OPTIONS}
                                value={language}
                                onChange={changeLanguage}
                            />

                            <InlineStack align="end">
                                <Button variant="primary" onClick={goNext}>
                                    {translate("onboarding.next")}
                                </Button>
                            </InlineStack>
                        </BlockStack>
                    </Card>
                )}

                {step === 2 && (
                    <Card>
                        <BlockStack gap="400">
                            <Text as="p">
                                {translate("onboarding.dpaDescription")}
                            </Text>

                            <Link
                                url="https://gl6.com/dpa"
                                target="_blank"
                                removeUnderline
                            >
                                {translate("onboarding.viewDpa")}
                            </Link>

                            <Checkbox
                                label={translate("onboarding.agree")}
                                checked={checked}
                                onChange={setChecked}
                                disabled={loading}
                            />

                            {error && (
                                <Banner tone="critical">
                                    <Text as="p">{error}</Text>
                                </Banner>
                            )}

                            <InlineStack align="space-between">
                                <Button
                                    onClick={goBack}
                                    disabled={loading}
                                >
                                    {translate("onboarding.back")}
                                </Button>

                                <Button
                                    variant="primary"
                                    loading={loading}
                                    disabled={!checked || loading}
                                    onClick={acceptDpa}
                                >
                                    {translate("onboarding.acceptContinue")}
                                </Button>
                            </InlineStack>
                        </BlockStack>
                    </Card>
                )}
            </BlockStack>
        </Page>
    );
}
