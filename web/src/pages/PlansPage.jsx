import { useState } from "react";
import { Page, Layout, Card, Text, Button, BlockStack, InlineStack, Banner, Badge } from "@shopify/polaris";
import { openManagedPricing } from "../api";
import FeatureList from "../components/FeatureList.jsx";

export default function PlansPage({ boot, onReload }) {
  const [state, setState] = useState({ working: false, error: "", message: "" });
  const plans = boot.plans;
  const entitlement = boot.shop.entitlement;

  async function managePlan() {

    try {

      setState({
        working: true,
        error: "",
        message: ""
      });

      const result = await openManagedPricing();

      if (result.confirmationUrl) {

        window.top.location.href = result.confirmationUrl;

      }

    } catch (e) {

      setState({
        working: false,
        error: e.message
      });

    }

  }

  return (
      <Page title="Plans">
        <Layout>

          <Layout.Section>
            <InlineStack gap="400">
              {entitlement?.isGrandfatheredFree && (
                  <Card>
                    <BlockStack gap="200">
                      <InlineStack gap="200" blockAlign="center">
                        <Text variant="headingMd">Grandfathered Free</Text>
                        <Badge tone="success">Current</Badge>
                      </InlineStack>
                      <Text>Legacy entitlement — no charge</Text>
                      <FeatureList items={plans.BASIC.features} />
                      <Text tone="subdued">
                        Upgrading permanently ends this legacy entitlement.
                      </Text>
                    </BlockStack>
                  </Card>
              )}

              <Card>
                <BlockStack>
                  <Text variant="headingMd">Pro</Text>
                  <Text>{plans.PRO.priceLabel}</Text>
                  <FeatureList items={plans.PRO.features} />

                  <InlineStack gap="200">
                    <Button variant="primary" onClick={managePlan} loading={state.working}>
                      {entitlement?.isPaid ? "Manage subscription" : "Subscribe to Pro"}
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
