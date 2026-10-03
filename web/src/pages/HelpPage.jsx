import { useState } from "react";
import {
    Page,
    Layout,
    Card,
    Text,
    BlockStack,
    Collapsible,
} from "@shopify/polaris";

const faqs = [
    {
        question: "Why is the withdrawal button not showing on my store?",
        answer:
            "Check that the EU Withdrawal Button app embed or app block is enabled in your current Shopify theme. If you recently changed or published a new theme, you may need to enable it again.",
    },
    {
        question: "Can I change where the withdrawal button appears?",
        answer:
            "Yes. Open Settings in the app to adjust the floating button position for desktop and mobile.",
    },
    {
        question: "Can I change the appearance of the button?",
        answer:
            "Yes. You can customise the available button appearance settings from the app Settings page.",
    },
    {
        question: "What happens when a customer submits a withdrawal request?",
        answer:
            "The request is recorded in the app and appears in the Requests section, where you can review it and update its status.",
    },
    {
        question: "Will I receive an email when a customer submits a request?",
        answer:
            "Yes, if you have configured a notification email in the app. Check your Settings page if notifications are not arriving.",
    },
    {
        question: "Can I change the withdrawal period?",
        answer:
            "Yes. The withdrawal period can be configured from the app Settings page.",
    },
    {
        question: "Does the app automatically refund or cancel an order?",
        answer:
            "No. Submitting a withdrawal request does not automatically refund or cancel the Shopify order. You remain in control of reviewing and processing the request.",
    },
    {
        question: "Can I see previous withdrawal requests?",
        answer:
            "Yes. Open the Requests section to view withdrawal requests submitted through the app.",
    },
    {
        question: "Does the app support multiple languages?",
        answer:
            "The app supports configurable languages. You can manage the available language options from Settings.",
    },
    {
        question: "I changed my Shopify theme and the button disappeared. What should I do?",
        answer:
            "Open the theme editor for your new theme and make sure the EU Withdrawal Button app embed or app block is enabled.",
    },
    {
        question: "Can I temporarily hide the withdrawal button?",
        answer:
            "Yes. You can disable the storefront button without uninstalling the app.",
    },
    {
        question: "Why am I not receiving notification emails?",
        answer:
            "Check that your notification email and email delivery settings are configured correctly in Settings. Also check your spam or junk folder.",
    },
    {
        question: "Does this app guarantee that my store is legally compliant?",
        answer:
            "No. The app provides tools to help you offer and manage withdrawal requests. You remain responsible for making sure your store policies and processes meet the laws that apply to your business.",
    },
];

function FaqItem({ question, answer }) {
    const [open, setOpen] = useState(false);

    return (
        <BlockStack gap="200">
            <Button
                variant="plain"
                textAlign="left"
                onClick={() => setOpen((current) => !current)}
                ariaExpanded={open}
            >
                {open ? "−" : "+"} {question}
            </Button>

            <Collapsible
                open={open}
                id={`faq-${question.replace(/\W+/g, "-").toLowerCase()}`}
                transition={{ duration: "200ms", timingFunction: "ease-in-out" }}
            >
                <Text as="p" tone="subdued">
                    {answer}
                </Text>
            </Collapsible>
        </BlockStack>
    );
}

export default function HelpPage() {
    return (
        <Page title="Help">
            <Layout>
                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <BlockStack gap="100">
                                <Text variant="headingMd">
                                    Common questions
                                </Text>

                                <Text as="p" tone="subdued">
                                    Find quick answers to common setup and
                                    troubleshooting questions.
                                </Text>
                            </BlockStack>

                            <BlockStack gap="400">
                                {faqs.map((faq) => (
                                    <FaqItem
                                        key={faq.question}
                                        question={faq.question}
                                        answer={faq.answer}
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
                                Still need help?
                            </Text>

                            <Text as="p">
                                If the answers above do not solve the issue,
                                use Shopify's Get support action from the app
                                menu in the top right. Shopify will open its
                                native support form and relay your message to us.
                            </Text>

                            <Text as="p" tone="subdued">
                                Support requests are usually answered within one
                                business day.
                            </Text>
                        </BlockStack>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}