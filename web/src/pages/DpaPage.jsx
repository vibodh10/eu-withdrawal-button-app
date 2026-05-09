import { Page, Card, Text, Button, BlockStack, Link, Checkbox } from "@shopify/polaris";
import { useState } from "react";
import { apiSend } from "../api";

export default function DpaPage({ onAccepted }) {
    const [loading, setLoading] = useState(false);
    const [checked, setChecked] = useState(false);

    async function acceptDpa() {
        if (!checked) return;

        setLoading(true);
        try {
            await apiSend("/admin/dpa/accept", "POST");
            onAccepted(); // reload app state
        } catch (e) {
            console.error(e);
            alert("Failed to accept DPA");
        } finally {
            setLoading(false);
        }
    }

    return (
        <Page title="Data Processing Agreement">
            <Card>
                <BlockStack gap="400">

                    <Text variant="bodyMd">
                        To use this app, you must agree to our Data Processing Agreement.
                        This outlines how customer data is processed on your behalf in compliance with GDPR.
                    </Text>

                    <Text variant="bodyMd">
                        <Link url="https://gl6.com/dpa" target="_blank" removeUnderline>
                            View Data Processing Agreement
                        </Link>
                    </Text>

                    <Checkbox
                        label="I have read and agree to the Data Processing Agreement"
                        checked={checked}
                        onChange={setChecked}
                    />

                    <Button
                        variant="primary"
                        loading={loading}
                        disabled={!checked}
                        onClick={acceptDpa}
                    >
                        Accept and continue
                    </Button>

                </BlockStack>
            </Card>
        </Page>
    );
}