import { useEffect, useState } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Grid,
  Button,
  Banner,
} from "@shopify/polaris";
import {apiGet, apiSend} from "../api";
import { isPro } from "../../../src/lib/plans.js";

export default function DashboardPage({ boot }) {
  const [stats, setStats] = useState({
    total: 0,
    received: 0,
    reviewed: 0,
    approved: 0,
    rejected: 0,
  });

  const [migrationLoading, setMigrationLoading] = useState(false);
  const [migrationResult, setMigrationResult] = useState(null);
  const [migrationError, setMigrationError] = useState(null);
  const [tokenTestLoading, setTokenTestLoading] = useState(false);
  const [tokenTestResult, setTokenTestResult] = useState(null);
  const [tokenTestError, setTokenTestError] = useState(null);

  const isFreshStartTestStore =
      boot?.shop?.shopDomain === "freshstartdevelopment.myshopify.com";

  useEffect(() => {
    apiGet("/admin/analytics/summary")
        .then((data) => setStats(data.summary))
        .catch(() => {});
  }, []);

  async function runTokenMigration() {
    const confirmed = window.confirm(
        "This will migrate this shop to expiring offline tokens. This action cannot be undone. Only continue if this is the freshstartdevelopment test store."
    );

    if (!confirmed) return;

    setMigrationLoading(true);
    setMigrationResult(null);
    setMigrationError(null);

    try {
      const data = await apiSend("/admin/migrate-expiring-token", "POST");

      setMigrationResult(data);
    } catch (error) {
      setMigrationError(error.message);
    } finally {
      setMigrationLoading(false);
    }
  }

  async function testShopifyToken() {
    setTokenTestLoading(true);
    setTokenTestResult(null);
    setTokenTestError(null);

    try {
      const data = await apiGet("/admin/test-shopify-token");
      setTokenTestResult(data);
    } catch (error) {
      setTokenTestError(error.message);
    } finally {
      setTokenTestLoading(false);
    }
  }

  return (
      <Page title="Dashboard">
        <Layout>

          {/* HERO */}
          <Layout.Section>
            <Card>
              <InlineStack align="space-between">
                <BlockStack gap="200">
                  <Text variant="headingMd">
                    {boot.shop.brandingName || boot.shop.shopDomain}
                  </Text>

                  <Text as="p">
                    Add a legally compliant EU withdrawal button to your storefront in minutes.
                    Collect customer withdrawal requests, manage them in one place and stay compliant with EU regulations without complex setup.
                  </Text>
                </BlockStack>

                <BlockStack gap="100">
                  <Text variant="headingSm">Plan</Text>
                  <Badge tone={boot.isPro ? "success" : "info"}>
                    {boot.shop.plan}
                  </Badge>
                  <Text as="p">
                    {boot.isPro ? "Pro features are active." : "Free plan is active."}
                  </Text>
                </BlockStack>
              </InlineStack>
            </Card>
          </Layout.Section>

          {/* STATS */}
          <Layout.Section>
            <Grid>
              <Grid.Cell columnSpan={{ xs: 6, sm: 3 }}>
                <Card>
                  <Text>Total requests</Text>
                  <Text variant="headingLg">{stats.total}</Text>
                  <Text tone="subdued">All time across this shop</Text>
                </Card>
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 6, sm: 3 }}>
                <Card>
                  <Text>Received</Text>
                  <Text variant="headingLg">{stats.received}</Text>
                  <Text tone="subdued">Waiting for action</Text>
                </Card>
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 6, sm: 3 }}>
                <Card>
                  <Text>Reviewed</Text>
                  <Text variant="headingLg">{stats.reviewed}</Text>
                  <Text tone="subdued">Manually assessed</Text>
                </Card>
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 6, sm: 3 }}>
                <Card>
                  <Text>Approved / Rejected</Text>
                  <Text variant="headingLg">
                    {stats.approved} / {stats.rejected}
                  </Text>
                  <Text tone="subdued">Closed states</Text>
                </Card>
              </Grid.Cell>
            </Grid>
          </Layout.Section>

          {/* NEXT STEPS */}
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd">Recommended next steps</Text>

                <BlockStack>
                  <Text>
                    <strong>Add the withdrawal button to your store</strong><br />
                    Go to Online Store → Customize and add the EU Withdrawal Button block to your page.
                  </Text>

                  <Text>
                    <strong>Test the customer experience</strong><br />
                    Submit a test request to see how customers will interact with the form.
                  </Text>

                  <Text>
                    <strong>Review requests in your dashboard</strong><br />
                    All submissions will appear in the Requests section where you can manage them.
                  </Text>

                  {!isPro && (
                      <Text>
                        <strong>(Optional) Upgrade to Pro</strong><br />
                        Unlock automation, advanced controls, and custom workflows.
                      </Text>
                  )}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>

        </Layout>
      </Page>
  );
}