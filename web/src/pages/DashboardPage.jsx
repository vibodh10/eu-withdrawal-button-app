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
import {apiGet, apiSend, syncBilling} from "../api";

export default function DashboardPage({ boot, onReload }) {
  const [stats, setStats] = useState({
    total: 0,
    received: 0,
    reviewed: 0,
    approved: 0,
    rejected: 0,
  });

  const [setupLoading, setSetupLoading] = useState(false);
  const [setupResult, setSetupResult] = useState(null);
  const [setupError, setSetupError] = useState(null);
  const [billingSyncing, setBillingSyncing] = useState(true);
  const [billingSyncError, setBillingSyncError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function refreshBillingStatus() {
      try {
        setBillingSyncing(true);
        setBillingSyncError("");

        const result = await syncBilling();

        console.log("Billing sync result:", result);

        const syncedPlan = result?.shop?.plan;
        const currentPlan = boot?.shop?.plan;

        // Reload boot data only when Shopify reports a different plan.
        if (
            !cancelled &&
            syncedPlan &&
            syncedPlan !== currentPlan
        ) {
          await onReload?.();
        }
      } catch (error) {
        console.error("Billing sync failed:", error);

        if (!cancelled) {
          setBillingSyncError(
              error.message || "Could not refresh subscription status."
          );
        }
      } finally {
        if (!cancelled) {
          setBillingSyncing(false);
        }
      }
    }

    refreshBillingStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    apiGet("/admin/analytics/summary")
        .then((data) => setStats(data.summary))
        .catch(() => {});
  }, []);

  const shopDomain = boot?.shop?.shopDomain;

  const SHOPIFY_API_KEY = import.meta.env.VITE_SHOPIFY_API_KEY;

  // This should match your app block liquid file name:
  // blocks/withdrawal-button.liquid = "withdrawal-button"
  const APP_BLOCK_HANDLE = "withdrawal-button";

  const withdrawalPageUrl = shopDomain
      ? `https://${shopDomain}/pages/eu-withdrawal`
      : "#";

  // For the floating sitewide button app embed.
  // This opens the App embeds panel.
  const floatingEmbedUrl = shopDomain
      ? `https://${shopDomain}/admin/themes/current/editor?context=apps`
      : "#";

  // For adding the section app block to a page.
  const appBlockDeepLink =
      shopDomain && SHOPIFY_API_KEY
          ? `https://${shopDomain}/admin/themes/current/editor?template=page&addAppBlockId=${SHOPIFY_API_KEY}/${APP_BLOCK_HANDLE}&target=mainSection`
          : "#";

  const storefrontUrl = shopDomain ? `https://${shopDomain}` : "#";

  const notificationsUrl = shopDomain
      ? `https://${shopDomain}/admin/email_templates/order_confirmation/preview`
      : "#";

  function openUrl(url) {
    if (!url || url === "#") return;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function openRequests() {
    window.location.href = "/requests";
  }

  async function createWithdrawalPage() {
    setSetupLoading(true);
    setSetupResult(null);
    setSetupError(null);

    try {
      const data = await apiSend("/admin/setup/withdrawal-page", "POST");
      setSetupResult(data);
    } catch (error) {
      setSetupError(error.message);
    } finally {
      setSetupLoading(false);
    }
  }

  return (
      <Page title="Dashboard">
        <Layout>
          {billingSyncing && (
              <Layout.Section>
                <Banner
                    tone="info"
                    title="Refreshing subscription status"
                >
                  <Text as="p">
                    Checking your Shopify subscription and activating available features.
                  </Text>
                </Banner>
              </Layout.Section>
          )}

          {billingSyncError && (
              <Layout.Section>
                <Banner
                    tone="warning"
                    title="Could not refresh subscription"
                >
                  <Text as="p">{billingSyncError}</Text>
                </Banner>
              </Layout.Section>
          )}

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

          {/* SETUP CHECKLIST */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text variant="headingMd">Complete your setup</Text>
                  <Text as="p" tone="subdued">
                    Choose the setup that works best for your store. We recommend enabling the floating sitewide button and also creating a dedicated withdrawal page.
                  </Text>
                </BlockStack>

                {setupResult && (
                    <Banner tone="success" title="Withdrawal page ready">
                      <Text as="p">
                        Your withdrawal page is ready. You can now add the app block to that page and link to it from your order confirmation emails.
                      </Text>
                    </Banner>
                )}

                {setupError && (
                    <Banner tone="critical" title="Setup action failed">
                      <Text as="p">{setupError}</Text>
                    </Banner>
                )}

                <BlockStack gap="300">
                  {/* OPTION 1 */}
                  <Card background="bg-surface-secondary">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Badge tone="success">Recommended</Badge>
                          <Text variant="headingSm">Enable floating sitewide button</Text>
                        </InlineStack>

                        <Text as="p" tone="subdued">
                          Best for visibility. This adds a floating withdrawal button across your storefront so customers can access the form from anywhere.
                        </Text>
                      </BlockStack>

                      <Button
                          variant="primary"
                          onClick={() => openUrl(floatingEmbedUrl)}
                      >
                        Enable floating button
                      </Button>
                    </InlineStack>
                  </Card>

                  {/* OPTION 2 */}
                  <Card background="bg-surface-secondary">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Badge tone="attention">Recommended</Badge>
                          <Text variant="headingSm">Create a dedicated withdrawal page</Text>
                        </InlineStack>

                        <Text as="p" tone="subdued">
                          Create a standard page at /pages/eu-withdrawal so customers have a clear place to submit withdrawal requests.
                        </Text>
                      </BlockStack>

                      <Button
                          loading={setupLoading}
                          disabled={setupLoading}
                          onClick={createWithdrawalPage}
                      >
                        Create page
                      </Button>
                    </InlineStack>
                  </Card>

                  {/* OPTION 3 */}
                  <Card background="bg-surface-secondary">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Badge tone="attention">Recommended</Badge>
                          <Text variant="headingSm">Add button block to the withdrawal page</Text>
                        </InlineStack>

                        <Text as="p" tone="subdued">
                          Open the theme editor and add the EU Withdrawal Button block to your dedicated withdrawal page.
                        </Text>
                      </BlockStack>

                      <Button onClick={() => openUrl(appBlockDeepLink)}>
                        Add page block
                      </Button>
                    </InlineStack>
                  </Card>

                  {/* OPTION 4 */}
                  <Card background="bg-surface-secondary">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Badge tone="info">Suggested</Badge>
                          <Text variant="headingSm">Add the link to order confirmation emails</Text>
                        </InlineStack>

                        <Text as="p" tone="subdued">
                          Add your withdrawal page link to Shopify order confirmation emails so customers can find it after purchase.
                        </Text>

                        <Text as="p">
                          Suggested link: <strong>{withdrawalPageUrl}</strong>
                        </Text>
                      </BlockStack>

                      <Button onClick={() => openUrl(notificationsUrl)}>
                        Open notifications
                      </Button>
                    </InlineStack>
                  </Card>

                  {/* OPTION 5 */}
                  <Card background="bg-surface-secondary">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Badge tone={stats.total > 0 ? "success" : "attention"}>
                            {stats.total > 0 ? "Done" : "Test"}
                          </Badge>
                          <Text variant="headingSm">Submit a test withdrawal request</Text>
                        </InlineStack>

                        <Text as="p" tone="subdued">
                          Visit your storefront or withdrawal page and submit a test request to confirm the customer experience works correctly.
                        </Text>
                      </BlockStack>

                      <InlineStack gap="200">
                        <Button onClick={() => openUrl(withdrawalPageUrl)}>
                          Open withdrawal page
                        </Button>

                        <Button onClick={() => openUrl(storefrontUrl)}>
                          Open storefront
                        </Button>
                      </InlineStack>
                    </InlineStack>
                  </Card>

                  {/* OPTION 6 */}
                  <Card background="bg-surface-secondary">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Badge tone={stats.total > 0 ? "success" : "attention"}>
                            {stats.total > 0 ? "Ready" : "Next"}
                          </Badge>
                          <Text variant="headingSm">Review requests in your dashboard</Text>
                        </InlineStack>

                        <Text as="p" tone="subdued">
                          Once a customer or test request is submitted, review it in the Requests section and update its status.
                        </Text>
                      </BlockStack>

                      <Button onClick={openRequests}>
                        Open requests
                      </Button>
                    </InlineStack>
                  </Card>

                  {!boot.isPro && (
                      <Card background="bg-surface-secondary">
                        <InlineStack align="space-between" blockAlign="center">
                          <BlockStack gap="100">
                            <InlineStack gap="200" blockAlign="center">
                              <Badge tone="info">Optional</Badge>
                              <Text variant="headingSm">Upgrade to Pro</Text>
                            </InlineStack>

                            <Text as="p" tone="subdued">
                              Unlock order verification, advanced controls, automation, and custom workflows.
                            </Text>
                          </BlockStack>

                          <Button url="/billing">
                            View Pro
                          </Button>
                        </InlineStack>
                      </Card>
                  )}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
  );
}