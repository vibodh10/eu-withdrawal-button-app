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
    Icon,
} from "@shopify/polaris";
import { CheckCircleIcon } from "@shopify/polaris-icons";
import { apiGet, apiSend, syncBilling } from "../api";

export default function DashboardPage({
                                          boot,
                                          onReload,
                                          onOpenSettings,
                                          onOpenRequests,
                                      }) {
    const [stats, setStats] = useState({
        total: 0,
        received: 0,
        reviewed: 0,
        approved: 0,
        rejected: 0,
    });

    const [setupStatus, setSetupStatus] = useState({
        notificationEmail: false,
        withdrawalPage: false,
        testRequest: false,
        reviewedRequest: false,
        floatingEmbed: false,
        pageBlock: false,
    });

    const [setupStatusLoading, setSetupStatusLoading] = useState(true);
    const [setupLoading, setSetupLoading] = useState(false);
    const [setupResult, setSetupResult] = useState(null);
    const [setupError, setSetupError] = useState(null);
    const [billingSyncError, setBillingSyncError] = useState("");

    const shopDomain = boot?.shop?.shopDomain;
    const SHOPIFY_API_KEY = import.meta.env.VITE_SHOPIFY_API_KEY;
    const APP_BLOCK_HANDLE = "withdrawal-button";

    const withdrawalPageUrl = shopDomain
        ? `https://${shopDomain}/pages/eu-withdrawal`
        : "#";

    const floatingEmbedUrl = shopDomain
        ? `https://${shopDomain}/admin/themes/current/editor?context=apps`
        : "#";

    const appBlockDeepLink =
        shopDomain && SHOPIFY_API_KEY
            ? `https://${shopDomain}/admin/themes/current/editor?template=page&addAppBlockId=${SHOPIFY_API_KEY}/${APP_BLOCK_HANDLE}&target=mainSection`
            : "#";

    const storefrontUrl = shopDomain ? `https://${shopDomain}` : "#";

    const notificationsUrl = shopDomain
        ? `https://${shopDomain}/admin/email_templates/order_confirmation/preview`
        : "#";

    function StatCard({ label, value, helpText }) {
        return (
            <Card>
                <div style={{ minHeight: "50px" }}>
                    <BlockStack gap="100">
                        <Text>{label}</Text>
                        <Text variant="headingLg">{value}</Text>
                        <Text tone="subdued">{helpText}</Text>
                    </BlockStack>
                </div>
            </Card>
        );
    }

    function SetupStatusIcon({ complete }) {
        if (complete) {
            return (
                <span
                    style={{
                        width: "20px",
                        height: "20px",
                        minWidth: "20px",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
          <Icon
              source={CheckCircleIcon}
              tone="success"
              accessibilityLabel="Complete"
          />
        </span>
            );
        }

        return (
            <span
                aria-label="Not complete"
                role="img"
                style={{
                    width: "20px",
                    height: "20px",
                    minWidth: "20px",
                    border: "2px dashed #8C9196",
                    borderRadius: "50%",
                    display: "inline-block",
                    boxSizing: "border-box",
                }}
            />
        );
    }

    function SetupCard({
                           complete,
                           showStatus = true,
                           badge,
                           badgeTone,
                           title,
                           description,
                           children,
                           actions,
                       }) {
        return (
            <Card background="bg-surface-secondary">
                <BlockStack gap="300">
                    <InlineStack gap="200" blockAlign="center" wrap>
                        {showStatus && <SetupStatusIcon complete={complete} />}

                        {badge && <Badge tone={badgeTone}>{badge}</Badge>}

                        <Text variant="headingSm">{title}</Text>
                    </InlineStack>

                    <Text as="p" tone="subdued">
                        {description}
                    </Text>

                    {children}

                    {actions && (
                        <InlineStack gap="200" wrap>
                            {actions}
                        </InlineStack>
                    )}
                </BlockStack>
            </Card>
        );
    }

    async function loadSetupStatus() {
        try {
            const data = await apiGet("/admin/setup/status");

            let floatingEmbed = false;
            let pageBlock = false;

            if (window.shopify?.app?.extensions) {
                const extensions = await window.shopify.app.extensions();

                const themeExtension = extensions.find(
                    (extension) => extension.type === "theme_app_extension"
                );

                const activations = themeExtension?.activations || [];

                floatingEmbed = activations.some(
                    (activation) =>
                        activation.target === "body" && activation.status === "active"
                );

                pageBlock = activations.some(
                    (activation) =>
                        activation.handle === APP_BLOCK_HANDLE &&
                        activation.target === "section" &&
                        activation.status === "active"
                );
            }

            setSetupStatus({
                notificationEmail: Boolean(data?.setup?.notificationEmail),
                withdrawalPage: Boolean(data?.setup?.withdrawalPage),
                testRequest: Boolean(data?.setup?.testRequest),
                reviewedRequest: Boolean(data?.setup?.reviewedRequest),
                floatingEmbed,
                pageBlock,
            });
        } catch (error) {
            console.error("Could not load setup status:", error);
        } finally {
            setSetupStatusLoading(false);
        }
    }

    useEffect(() => {
        let cancelled = false;

        async function refreshSetupStatus() {
            if (cancelled) return;
            await loadSetupStatus();
        }

        refreshSetupStatus();

        function handleVisibilityChange() {
            if (!cancelled && document.visibilityState === "visible") {
                refreshSetupStatus();
            }
        }

        document.addEventListener("visibilitychange", handleVisibilityChange);

        return () => {
            cancelled = true;
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        async function refreshBillingStatus() {
            try {
                setBillingSyncError("");

                const result = await syncBilling();
                const syncedPlan = result?.shop?.plan;
                const currentPlan = boot?.shop?.plan;

                if (!cancelled && syncedPlan && syncedPlan !== currentPlan) {
                    await onReload?.({ silent: true });
                }
            } catch (error) {
                console.error("Billing sync failed:", error);

                if (!cancelled) {
                    setBillingSyncError(
                        error.message || "Could not refresh subscription status."
                    );
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

    function openUrl(url) {
        if (!url || url === "#") return;
        window.open(url, "_blank", "noopener,noreferrer");
    }

    async function createWithdrawalPage() {
        setSetupLoading(true);
        setSetupResult(null);
        setSetupError(null);

        try {
            const data = await apiSend("/admin/setup/withdrawal-page", "POST");
            setSetupResult(data);
            setSetupStatus((current) => ({
                ...current,
                withdrawalPage: true,
            }));
        } catch (error) {
            setSetupError(error.message);
        } finally {
            setSetupLoading(false);
        }
    }

    return (
        <Page title="Dashboard">
            <Layout>
                {billingSyncError && (
                    <Layout.Section>
                        <Banner tone="warning" title="Could not refresh subscription">
                            <Text as="p">{billingSyncError}</Text>
                        </Banner>
                    </Layout.Section>
                )}

                <Layout.Section>
                    <Card>
                        <InlineStack align="space-between" gap="400" wrap>
                            <BlockStack gap="200">
                                <Text variant="headingMd">
                                    {boot.shop.brandingName || boot.shop.shopDomain}
                                </Text>

                                <Text as="p">
                                    Add a legally compliant EU withdrawal button to your storefront
                                    in minutes. Collect customer withdrawal requests, manage them in
                                    one place and stay compliant with EU regulations without complex
                                    setup.
                                </Text>
                            </BlockStack>

                            <BlockStack gap="100">
                                <Text variant="headingSm">Plan</Text>
                                <Badge
                                    tone={boot.shop.entitlement?.isPaid ? "success" : "info"}
                                >
                                    {boot.shop.entitlement?.isGrandfatheredFree
                                        ? "Grandfathered Free"
                                        : "Pro"}
                                </Badge>
                                <Text as="p">
                                    {boot.shop.entitlement?.isPaid
                                        ? "Pro features are active."
                                        : "Grandfathered Free access is active."}
                                </Text>
                            </BlockStack>
                        </InlineStack>
                    </Card>
                </Layout.Section>

                <Layout.Section>
                    <Grid>
                        <Grid.Cell columnSpan={{ xs: 6, sm: 3 }}>
                            <StatCard
                                label="Total requests"
                                value={stats.total}
                                helpText="All time across this shop"
                            />
                        </Grid.Cell>

                        <Grid.Cell columnSpan={{ xs: 6, sm: 3 }}>
                            <StatCard
                                label="Received"
                                value={stats.received}
                                helpText="Waiting for action"
                            />
                        </Grid.Cell>

                        <Grid.Cell columnSpan={{ xs: 6, sm: 3 }}>
                            <StatCard
                                label="Reviewed"
                                value={stats.reviewed}
                                helpText="Manually assessed"
                            />
                        </Grid.Cell>

                        <Grid.Cell columnSpan={{ xs: 6, sm: 3 }}>
                            <StatCard
                                label="Approved / Rejected"
                                value={`${stats.approved} / ${stats.rejected}`}
                                helpText="Closed states"
                            />
                        </Grid.Cell>
                    </Grid>
                </Layout.Section>

                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <BlockStack gap="100">
                                <Text variant="headingMd">Complete your setup</Text>
                                <Text as="p" tone="subdued">
                                    Choose the setup that works best for your store. We recommend
                                    enabling the floating sitewide button and also creating a
                                    dedicated withdrawal page.
                                </Text>
                            </BlockStack>

                            {setupResult && (
                                <Banner tone="success" title="Withdrawal page ready">
                                    <Text as="p">
                                        Your withdrawal page is ready. You can now add the app block to
                                        that page and link to it from your order confirmation emails.
                                    </Text>
                                </Banner>
                            )}

                            {setupError && (
                                <Banner tone="critical" title="Setup action failed">
                                    <Text as="p">{setupError}</Text>
                                </Banner>
                            )}

                            <BlockStack gap="300">
                                <SetupCard
                                    complete={setupStatus.notificationEmail}
                                    title="Add your notification email"
                                    description="Enter the email address where you want to receive notifications when a customer submits a withdrawal request."
                                    actions={
                                        <Button
                                            variant={
                                                boot.shop.merchantNotification ? "secondary" : "primary"
                                            }
                                            onClick={onOpenSettings}
                                        >
                                            {boot.shop.merchantNotification
                                                ? "Edit notification settings"
                                                : "Add your notification email"}
                                        </Button>
                                    }
                                >
                                    {boot.shop.merchantNotification && (
                                        <Text as="p">
                                            Notifications will be sent to{" "}
                                            <strong>{boot.shop.merchantNotification}</strong>.
                                        </Text>
                                    )}
                                </SetupCard>

                                <SetupCard
                                    complete={setupStatus.floatingEmbed}
                                    badge="Recommended"
                                    badgeTone="success"
                                    title="Enable floating sitewide button"
                                    description="Best for visibility. This adds a floating withdrawal button across your storefront so customers can access the form from anywhere."
                                    actions={
                                        <Button
                                            variant="primary"
                                            onClick={() => openUrl(floatingEmbedUrl)}
                                        >
                                            Enable floating button
                                        </Button>
                                    }
                                />

                                <SetupCard
                                    complete={setupStatus.withdrawalPage}
                                    badge="Recommended"
                                    badgeTone="attention"
                                    title="Create a dedicated withdrawal page"
                                    description="Create a standard page at /pages/eu-withdrawal so customers have a clear place to submit withdrawal requests."
                                    actions={
                                        <Button
                                            loading={setupLoading}
                                            disabled={setupLoading}
                                            onClick={createWithdrawalPage}
                                        >
                                            Create page
                                        </Button>
                                    }
                                />

                                <SetupCard
                                    complete={setupStatus.pageBlock}
                                    badge="Recommended"
                                    badgeTone="attention"
                                    title="Add button block to the withdrawal page"
                                    description="Open the theme editor and add the EU Withdrawal Button block to your dedicated withdrawal page."
                                    actions={
                                        <Button onClick={() => openUrl(appBlockDeepLink)}>
                                            Add page block
                                        </Button>
                                    }
                                />

                                <SetupCard
                                    showStatus={false}
                                    badge="Suggested"
                                    badgeTone="info"
                                    title="Add the link to order confirmation emails"
                                    description="Add your withdrawal page link to Shopify order confirmation emails so customers can find it after purchase."
                                    actions={
                                        <Button onClick={() => openUrl(notificationsUrl)}>
                                            Open notifications
                                        </Button>
                                    }
                                >
                                    <Text as="p">
                                        Suggested link: <strong>{withdrawalPageUrl}</strong>
                                    </Text>
                                </SetupCard>

                                <SetupCard
                                    complete={setupStatus.testRequest}
                                    title="Submit a test withdrawal request"
                                    description="Visit your storefront or withdrawal page and submit a test request to confirm the customer experience works correctly."
                                    actions={
                                        <>
                                            <Button onClick={() => openUrl(withdrawalPageUrl)}>
                                                Open withdrawal page
                                            </Button>
                                            <Button onClick={() => openUrl(storefrontUrl)}>
                                                Open storefront
                                            </Button>
                                        </>
                                    }
                                />

                                <SetupCard
                                    complete={setupStatus.reviewedRequest}
                                    title="Review requests in your dashboard"
                                    description="Once a customer or test request is submitted, review it in the Requests section and update its status."
                                    actions={
                                        <Button onClick={onOpenRequests}>Open requests</Button>
                                    }
                                />

                                {!boot.isPro && (
                                    <SetupCard
                                        showStatus={false}
                                        badge="Optional"
                                        badgeTone="info"
                                        title="Upgrade to Pro"
                                        description="Unlock order verification, advanced controls, automation, and custom workflows."
                                        actions={<Button url="/billing">View Pro</Button>}
                                    />
                                )}
                            </BlockStack>
                        </BlockStack>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}