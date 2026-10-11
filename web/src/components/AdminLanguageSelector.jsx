import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
    Card,
    Text,
    Select,
    Banner,
    BlockStack,
} from "@shopify/polaris";

import { apiSend } from "../api";
import { normalizeAdminLanguage } from "../i18n";

import { EU_LANGUAGE_OPTIONS as LANGUAGE_OPTIONS } from "../../../shared/euLanguages.js";

export default function AdminLanguageSelector({
                                                  savedLanguage = "en",
                                                  onSaved,
                                                  disabled = false,
                                              }) {
    const { t, i18n } = useTranslation();

    const [language, setLanguage] = useState(() =>
        normalizeAdminLanguage(savedLanguage)
    );

    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        setLanguage(normalizeAdminLanguage(savedLanguage));
    }, [savedLanguage]);

    async function handleChange(value) {
        const nextLanguage = normalizeAdminLanguage(value);

        if (saving || disabled || nextLanguage === language) {
            return;
        }

        setSaving(true);
        setError("");

        try {
            const result = await apiSend(
                "/admin/admin-locale",
                "PATCH",
                { adminLocale: nextLanguage }
            );

            const confirmedLanguage =
                normalizeAdminLanguage(result.adminLocale);

            setLanguage(confirmedLanguage);

            await i18n.changeLanguage(confirmedLanguage);

            await onSaved?.();
        } catch (err) {
            console.error("Language update failed:", err);
            setError(t("appLanguage.saveError"));
        } finally {
            setSaving(false);
        }
    }

    return (
        <Card>
            <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                    {t("appLanguage.title")}
                </Text>

                <Text as="p">
                    {t("appLanguage.description")}
                </Text>

                <Select
                    label={t("appLanguage.label")}
                    options={LANGUAGE_OPTIONS}
                    value={language}
                    onChange={handleChange}
                    disabled={saving || disabled}
                />

                {error && (
                    <Banner tone="critical">
                        <Text as="p">{error}</Text>
                    </Banner>
                )}
            </BlockStack>
        </Card>
    );
}