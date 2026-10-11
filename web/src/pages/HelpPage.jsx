
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
    Page,
    Layout,
    Card,
    Text,
    BlockStack,
    Button,
    Collapsible,
} from "@shopify/polaris";

const FAQ_KEYS = [
    "canvasSupport",
    "buttonNotShowing",
    "buttonPosition",
    "buttonAppearance",
    "requestSubmitted",
    "notificationEmail",
    "withdrawalPeriod",
    "automaticRefund",
    "previousRequests",
    "multipleLanguages",
    "themeChanged",
    "hideButton",
    "missingEmails",
    "legalCompliance",
];

function FaqItem({ faqKey }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);

    const question = t(
        `help.faqs.${faqKey}.question`
    );

    const answer = t(
        `help.faqs.${faqKey}.answer`
    );

    return (
        <BlockStack gap="200">
            <Button
                variant="plain"
                textAlign="left"
                onClick={() =>
                    setOpen((current) => !current)
                }
                ariaExpanded={open}
                ariaControls={`faq-${faqKey}`}
            >
                {open ? "−" : "+"} {question}
            </Button>

            <Collapsible
                open={open}
                id={`faq-${faqKey}`}
                transition={{
                    duration: "200ms",
                    timingFunction: "ease-in-out",
                }}
            >
                <Text as="p" tone="subdued">
                    {answer}
                </Text>
            </Collapsible>
        </BlockStack>
    );
}

export default function HelpPage() {
    const { t } = useTranslation();

    return (
        <Page title={t("help.title")}>
            <Layout>
                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <BlockStack gap="100">
                                <Text variant="headingMd">
                                    {t("help.commonQuestions")}
                                </Text>

                                <Text as="p" tone="subdued">
                                    {t("help.introduction")}
                                </Text>
                            </BlockStack>

                            <BlockStack gap="400">
                                {FAQ_KEYS.map((faqKey) => (
                                    <FaqItem
                                        key={faqKey}
                                        faqKey={faqKey}
                                    />
                                ))}
                            </BlockStack>
                        </BlockStack>
                    </Card>
                </Layout.Section>

                <Layout.Section>
                    <Card>
                        <BlockStack gap="300">
                            <Text variant="headingMd">
                                {t("help.supportTitle")}
                            </Text>

                            <Text as="p">
                                {t("help.supportDescription")}
                            </Text>

                            <Text as="p" tone="subdued">
                                {t("help.supportResponse")}
                            </Text>
                        </BlockStack>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}