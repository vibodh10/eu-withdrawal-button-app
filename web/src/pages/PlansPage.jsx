import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
    Page,
    Layout,
    Card,
    Text,
    Button,
    BlockStack,
    InlineStack,
    Banner,
    Badge,
} from "@shopify/polaris";

import { openManagedPricing } from "../api";
import FeatureList from "../components/FeatureList.jsx";

export default function PlansPage({ boot }) {
    const { t } = useTranslation();

    const [state, setState] = useState({
        working: false,
        error: "",
    });

    const plans = boot.plans;
    const entitlement = boot.shop.entitlement;

    async function managePlan() {
        try {
            setState({
                working: true,
                error: "",
            });

            const result = await openManagedPricing();

            if (result.confirmationUrl) {
                window.top.location.href = result.confirmationUrl;
                return;
            }

            setState({
                working: false,
                error: t("plans.errors.missingUrl"),
            });
        } catch (error) {
            setState({
                working: false,
                error:
                    error.message ||
                    t("plans.errors.openFailed"),
            });
        }
    }

    return (
        <Page title={t("plans.title")}>
            <Layout>

                {state.error && (
                    <Layout.Section>
                        <Banner
                            tone="critical"
                            title={t("plans.errors.title")}
                            onDismiss={() =>
                                setState((current) => ({
                                    ...current,
                                    error: "",
                                }))
                            }
                        >
                            <Text as="p">
                                {state.error}
                            </Text>
                        </Banner>
                    </Layout.Section>
                )}

                <Layout.Section>
                    <InlineStack gap="400">

                        {entitlement?.isGrandfatheredFree && (
                            <Card>
                                <BlockStack gap="200">

                                    <InlineStack
                                        gap="200"
                                        blockAlign="center"
                                    >
                                        <Text variant="headingMd">
                                            {t("plans.grandfatheredFree")}
                                        </Text>

                                        <Badge tone="success">
                                            {t("plans.current")}
                                        </Badge>
                                    </InlineStack>

                                    <Text>
                                        {t("plans.legacyDescription")}
                                    </Text>

                                    <FeatureList
                                        items={plans.BASIC.features}
                                    />

                                    <Text tone="subdued">
                                        {t("plans.legacyWarning")}
                                    </Text>

                                </BlockStack>
                            </Card>
                        )}

                        <Card>
                            <BlockStack>

                                <Text variant="headingMd">
                                    {t("plans.pro")}
                                </Text>

                                <Text>
                                    {plans.PRO.priceLabel}
                                </Text>

                                <FeatureList
                                    items={plans.PRO.features}
                                />

                                <InlineStack gap="200">
                                    <Button
                                        variant="primary"
                                        onClick={managePlan}
                                        loading={state.working}
                                    >
                                        {entitlement?.isPaid
                                            ? t("plans.manageSubscription")
                                            : t("plans.subscribePro")}
                                    </Button>
                                </InlineStack>

                            </BlockStack>
                        </Card>

                    </InlineStack>
                </Layout.Section>

            </Layout>
        </Page>
    );
}
