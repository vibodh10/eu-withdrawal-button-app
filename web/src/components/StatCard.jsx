import { Card, Text, BlockStack } from "@shopify/polaris";

export default function StatCard({ label, value, help }) {
    return (
        <Card>
            <BlockStack gap="100">
                <Text tone="subdued">{label}</Text>
                <Text variant="headingLg">{value}</Text>
                {help ? <Text tone="subdued">{help}</Text> : null}
            </BlockStack>
        </Card>
    );
}