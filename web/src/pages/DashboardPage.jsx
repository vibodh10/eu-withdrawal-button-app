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
import { useTranslation } from "react-i18next";

export default function DashboardPage({
                                          boot,
                                          onReload,
                                          onOpenSettings,
                                          onOpenRequests,
    onOpenPlans,
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
    const { t } = useTranslation();

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
              accessibilityLabel={t("dashboard.status.complete")}
          />
        </span>
            );
        }

        return (
            <span
                aria-label={t("dashboard.status.incomplete")}
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
                        error.message === "Failed to sync billing state"
                            ? "billingSyncFailed"
                            : "subscriptionStatusError"
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
        <Page title={t("dashboard.title")}>
            <Layout>
                {billingSyncError && (
                    <Layout.Section>
                        <Banner
                            tone="warning"
                            title={t("dashboard.subscriptionError")}
                        >
                            <Text as="p">
                                {t(`dashboard.${billingSyncError}`)}
                            </Text>
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
                                    {t("dashboard.description")}
                                </Text>
                            </BlockStack>

                            <BlockStack gap="100">
                                <Text variant="headingSm">
                                    {t("dashboard.plan")}
                                </Text>
                                <Badge
                                    tone={boot.shop.entitlement?.isPaid ? "success" : "info"}
                                >
                                    {boot.shop.entitlement?.isGrandfatheredFree
                                        ? t("dashboard.grandfatheredFree")
                                        : t("dashboard.planPro")}
                                </Badge>
                                <Text as="p">
                                    {boot.shop.entitlement?.isPaid
                                        ? t("dashboard.proActive")
                                        : t("dashboard.freeActive")}
                                </Text>
                            </BlockStack>
                        </InlineStack>
                    </Card>
                </Layout.Section>

                <Layout.Section>
                    <Grid>
                        <Grid.Cell columnSpan={{ xs: 6, sm: 3 }}>
                            <StatCard
                                label={t("dashboard.stats.total")}
                                value={stats.total}
                                helpText={t("dashboard.stats.totalHelp")}
                            />
                        </Grid.Cell>

                        <Grid.Cell columnSpan={{ xs: 6, sm: 3 }}>
                            <StatCard
                                label={t("dashboard.stats.received")}
                                value={stats.received}
                                helpText={t("dashboard.stats.receivedHelp")}
                            />
                        </Grid.Cell>

                        <Grid.Cell columnSpan={{ xs: 6, sm: 3 }}>
                            <StatCard
                                label={t("dashboard.stats.reviewed")}
                                value={stats.reviewed}
                                helpText={t("dashboard.stats.reviewedHelp")}
                            />
                        </Grid.Cell>

                        <Grid.Cell columnSpan={{ xs: 6, sm: 3 }}>
                            <StatCard
                                label={t("dashboard.stats.closed")}
                                value={`${stats.approved} / ${stats.rejected}`}
                                helpText={t("dashboard.stats.closedHelp")}
                            />
                        </Grid.Cell>
                    </Grid>
                </Layout.Section>


                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <BlockStack gap="100">
                                <Text variant="headingMd">
                                    {t("dashboard.setup.title")}
                                </Text>
                                <Text as="p" tone="subdued">
                                    {t("dashboard.setup.description")}
                                </Text>
                            </BlockStack>

                            {setupResult && (
                                <Banner
                                    tone="success"
                                    title={t("dashboard.setup.pageReady.title")}
                                >
                                    <Text as="p">
                                        {t("dashboard.setup.pageReady.description")}
                                    </Text>
                                </Banner>
                            )}

                            {setupError && (
                                <Banner
                                    tone="critical"
                                    title={t("dashboard.setup.actionFailed")}
                                >
                                    <Text as="p">{setupError}</Text>
                                </Banner>
                            )}

                            <BlockStack gap="300">
                                <SetupCard
                                    complete={setupStatus.notificationEmail}
                                    title={t("dashboard.setup.notification.title")}
                                    description={t("dashboard.setup.notification.description")}
                                    actions={
                                        <Button
                                            variant={
                                                boot.shop.merchantNotification
                                                    ? "secondary"
                                                    : "primary"
                                            }
                                            onClick={onOpenSettings}
                                        >
                                            {boot.shop.merchantNotification
                                                ? t("dashboard.setup.notification.edit")
                                                : t("dashboard.setup.notification.add")}
                                        </Button>
                                    }
                                >
                                    {boot.shop.merchantNotification && (
                                        <Text as="p">
                                            {t("dashboard.setup.notification.destination", {
                                                email: boot.shop.merchantNotification,
                                            })}
                                        </Text>
                                    )}
                                </SetupCard>

                                <SetupCard
                                    complete={setupStatus.floatingEmbed}
                                    badge={t("dashboard.setup.recommended")}
                                    badgeTone="success"
                                    title={t("dashboard.setup.floating.title")}
                                    description={t("dashboard.setup.floating.description")}
                                    actions={
                                        <Button
                                            variant="primary"
                                            onClick={() => openUrl(floatingEmbedUrl)}
                                        >
                                            {t("dashboard.setup.floating.button")}
                                        </Button>
                                    }
                                />

                                <SetupCard
                                    complete={setupStatus.withdrawalPage}
                                    badge={t("dashboard.setup.recommended")}
                                    badgeTone="attention"
                                    title={t("dashboard.setup.withdrawalPage.title")}
                                    description={t("dashboard.setup.withdrawalPage.description")}
                                    actions={
                                        <Button
                                            loading={setupLoading}
                                            disabled={setupLoading}
                                            onClick={createWithdrawalPage}
                                        >
                                            {t("dashboard.setup.withdrawalPage.button")}
                                        </Button>
                                    }
                                />

                                <SetupCard
                                    complete={setupStatus.pageBlock}
                                    badge={t("dashboard.setup.recommended")}
                                    badgeTone="attention"
                                    title={t("dashboard.setup.pageBlock.title")}
                                    description={t("dashboard.setup.pageBlock.description")}
                                    actions={
                                        <Button onClick={() => openUrl(appBlockDeepLink)}>
                                            {t("dashboard.setup.pageBlock.button")}
                                        </Button>
                                    }
                                />

                                <SetupCard
                                    showStatus={false}
                                    badge={t("dashboard.setup.suggested")}
                                    badgeTone="info"
                                    title={t("dashboard.setup.orderEmail.title")}
                                    description={t("dashboard.setup.orderEmail.description")}
                                    actions={
                                        <Button onClick={() => openUrl(notificationsUrl)}>
                                            {t("dashboard.setup.orderEmail.button")}
                                        </Button>
                                    }
                                >
                                    <Text as="p">
                                        {t("dashboard.setup.orderEmail.suggestedLink")}{" "}
                                        <strong>{withdrawalPageUrl}</strong>
                                    </Text>
                                </SetupCard>

                                <SetupCard
                                    complete={setupStatus.testRequest}
                                    title={t("dashboard.setup.testRequest.title")}
                                    description={t("dashboard.setup.testRequest.description")}
                                    actions={
                                        <>
                                            <Button onClick={() => openUrl(withdrawalPageUrl)}>
                                                {t("dashboard.setup.testRequest.openPage")}
                                            </Button>
                                            <Button onClick={() => openUrl(storefrontUrl)}>
                                                {t("dashboard.setup.testRequest.openStorefront")}
                                            </Button>
                                        </>
                                    }
                                />

                                <SetupCard
                                    complete={setupStatus.reviewedRequest}
                                    title={t("dashboard.setup.review.title")}
                                    description={t("dashboard.setup.review.description")}
                                    actions={
                                        <Button onClick={onOpenRequests}>
                                            {t("dashboard.setup.review.button")}
                                        </Button>
                                    }
                                />

                                {!boot.isPro && (
                                    <SetupCard
                                        showStatus={false}
                                        badge={t("dashboard.setup.optional")}
                                        badgeTone="info"
                                        title={t("dashboard.setup.upgrade.title")}
                                        description={t("dashboard.setup.upgrade.description")}
                                        actions={
                                            <Button onClick={onOpenPlans}>
                                                {t("dashboard.setup.upgrade.button")}
                                            </Button>
                                        }
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