import { useState } from "react";
import { Page, Layout, Card, Text, Button, BlockStack, InlineStack, Banner } from "@shopify/polaris";
import { openManagedPricing, syncBilling } from "../api";
import FeatureList from "../components/FeatureList.jsx";

export default function PlansPage({ boot, onReload }) {
  const [state, setState] = useState({ working: false, error: "", message: "" });
  const plans = boot.plans;

  async function managePlan() {

    try {

      setState({
        working: true,
        error: "",
        message: ""
      });

      const result = await openManagedPricing();

      if (result.confirmationUrl) {

        open(result.confirmationUrl, "_top");

      }

    } catch (e) {

      setState({
        working: false,
        error: e.message
      });

    }

  }

  async function refreshBilling() {
    try {
      setState({ working: true, error: "", message: "" });
      const result = await syncBilling();
      setState({ working: false, message: `Billing synced. Active plan: ${result.shop.plan}.` });
      onReload?.();
    } catch (e) {
      setState({ working: false, error: e.message });
    }
  }

  return (
      <Page title="Plans">
        <Layout>

          <Layout.Section>
            <InlineStack gap="400">
              <Card>
                <BlockStack>
                  <Text variant="headingMd">Basic</Text>
                  <Text>{plans.BASIC.priceLabel}</Text>
                  <FeatureList items={plans.BASIC.features} />
                </BlockStack>
              </Card>

              <Card>
                <BlockStack>
                  <Text variant="headingMd">Pro</Text>
                  <Text>{plans.PRO.priceLabel}</Text>
                  <FeatureList items={plans.PRO.features} />

                  <InlineStack gap="200">
                    <Button variant="primary" onClick={managePlan} loading={state.working}>
                      {boot.shop.plan === "PRO" ? "Manage plan" : "Upgrade to Pro"}
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