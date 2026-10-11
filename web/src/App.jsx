import { useEffect, useMemo, useState } from "react";
import {
    AppProvider,
    Frame,
    Navigation,
    Page,
    Card,
    Text,
    SkeletonBodyText, SkeletonDisplayText, Layout, Grid
} from "@shopify/polaris";
import {
    HomeIcon,
    OrderIcon,
    SettingsIcon,
    ProductIcon,
    QuestionCircleIcon
} from "@shopify/polaris-icons";

import { apiGet } from "./api";
import DashboardPage from "./pages/DashboardPage.jsx";
import RequestsPage from "./pages/RequestsPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import PlansPage from "./pages/PlansPage.jsx";
import DpaPage from "./pages/DpaPage.jsx";
import HelpPage from "./pages/HelpPage.jsx";
import { useTranslation } from "react-i18next";

import {
    normalizeAdminLanguage,
} from "./i18n";

import polarisEn from "@shopify/polaris/locales/en.json";
import polarisDe from "@shopify/polaris/locales/de.json";

const POLARIS_TRANSLATIONS = {
    en: polarisEn,
    de: polarisDe,
};

const tabs = [
    { key: "dashboard", labelKey: "navigation.dashboard", icon: HomeIcon },
    { key: "requests", labelKey: "navigation.requests", icon: OrderIcon },
    { key: "settings", labelKey: "navigation.settings", icon: SettingsIcon },
    { key: "plans", labelKey: "navigation.plans", icon: ProductIcon },
    { key: "help", labelKey: "navigation.help", icon: QuestionCircleIcon },
];

export default function App() {
    const { t, i18n } = useTranslation();

    const adminLanguage = normalizeAdminLanguage(
        i18n.resolvedLanguage || i18n.language
    );
    const [tab, setTab] = useState("dashboard");

    const [boot, setBoot] = useState({ loading: true, error: "", data: null });
    const [settingsDirty, setSettingsDirty] = useState(false);

    const title = useMemo(() => {
        if (boot.data?.shop?.entitlement?.kind === "PAYMENT_REQUIRED") {
            return t("navigation.plans");
        }
        const active = tabs.find((item) => item.key === tab);
        return active
            ? t(`navigation.${active.key}`)
            : t("navigation.dashboard");
    }, [tab, boot.data, t]);

    function handleTabChange(nextTab) {
        if (nextTab === tab) {
            return;
        }

        if (tab === "settings" && settingsDirty) {
            return;
        }

        setTab(nextTab);
    }

    async function load({ silent = false } = {}) {
        try {
            if (!silent) {
                setBoot((prev) => ({
                    ...prev,
                    loading: true,
                    error: "",
                }));
            }

            const data = await apiGet("/admin/me");

            const savedLanguage = normalizeAdminLanguage(
                data.shop?.adminLocale
            );

            if (i18n.language !== savedLanguage) {
                await i18n.changeLanguage(savedLanguage);
            }

            setBoot({
                loading: false,
                error: "",
                data,
            });
        } catch (err) {
            console.error(err);

            if (err.status === 401 && err.data?.redirectTo) {
                window.open(err.data.redirectTo, "_top");
                return;
            }

            setBoot((prev) => ({
                ...prev,
                loading: false,
                error: err.message || "Could not load the app.",
            }));
        }
    }

    useEffect(() => {
        load();
    }, []);

    useEffect(() => {
        const savedLanguage = boot.data?.shop?.adminLocale;

        if (!savedLanguage) return;

        const nextLanguage =
            normalizeAdminLanguage(savedLanguage);

        if (i18n.language !== nextLanguage) {
            void i18n.changeLanguage(nextLanguage);
        }
    }, [boot.data?.shop?.adminLocale, i18n]);

    const navigation = (
        <Navigation location="/">
            <Navigation.Section
                items={(boot.data?.shop?.entitlement?.kind === "PAYMENT_REQUIRED"
                        ? tabs.filter(
                            (item) =>
                                item.key === "plans" ||
                                item.key === "help"
                        )
                        : tabs
                ).map((item) => ({
                    label: t(item.labelKey),
                    icon: item.icon,
                    selected: item.key === tab,
                    onClick: () => handleTabChange(item.key)
                }))}
            />


            <Navigation.Section
                title={t("navigation.currentPlan")}
                items={[
                    {
                        label: boot.data?.shop?.entitlement?.isGrandfatheredFree
                            ? t("navigation.planGrandfathered")
                            : boot.data?.shop?.entitlement?.isPaid
                                ? t("navigation.planPro")
                                : t("navigation.planRequired"),
                    },
                    {
                        label: boot.data?.shop?.entitlement?.isPaid
                            ? t("navigation.premiumActive")
                            : boot.data?.shop?.entitlement?.isGrandfatheredFree
                                ? t("navigation.grandfatheredActive")
                                : t("navigation.subscribeToContinue"),
                    },
                ]}
            />
        </Navigation>
    );

    return (
        <AppProvider
            i18n={POLARIS_TRANSLATIONS[adminLanguage]}
        >
            <Frame navigation={boot.data?.shop?.dpaAcceptedAt ? navigation : null}>
                {boot.loading && (
                    <Page>
                        <Layout>
                            <Layout.Section>
                                <Card>
                                    <div style={{ minHeight: "120px" }}>
                                        <SkeletonDisplayText size="small" />
                                        <div style={{ marginTop: "16px" }}>
                                            <SkeletonBodyText lines={2} />
                                        </div>
                                    </div>
                                </Card>
                            </Layout.Section>

                            <Layout.Section>
                                <Grid>
                                    {[1, 2, 3, 4].map((item) => (
                                        <Grid.Cell
                                            key={item}
                                            columnSpan={{ xs: 6, sm: 3 }}
                                        >
                                            <Card>
                                                <div style={{ minHeight: "112px" }}>
                                                    <SkeletonBodyText lines={3} />
                                                </div>
                                            </Card>
                                        </Grid.Cell>
                                    ))}
                                </Grid>
                            </Layout.Section>

                            <Layout.Section>
                                <Card>
                                    <div style={{ minHeight: "480px" }}>
                                        <SkeletonDisplayText size="small" />
                                        <div style={{ marginTop: "20px" }}>
                                            <SkeletonBodyText lines={10} />
                                        </div>
                                    </div>
                                </Card>
                            </Layout.Section>
                        </Layout>
                    </Page>
                )}

                {!boot.loading && boot.error && (
                    <Page title={title}>
                        <Card>
                            <Text tone="critical">{boot.error}</Text>
                        </Card>
                    </Page>
                )}

                {!boot.loading && !boot.error && boot.data && (
                    <>
                        {!boot.data.shop?.dpaAcceptedAt ? (
                            <DpaPage onAccepted={load} />
                        ) : boot.data.shop?.entitlement?.kind === "PAYMENT_REQUIRED" ? (
                            tab === "help" ? (
                                <HelpPage />
                            ) : (
                                <PlansPage
                                    boot={boot.data}
                                    onReload={load}
                                />
                            )
                        ) : (
                            <>
                                {tab === "dashboard" && (
                                    <DashboardPage
                                        boot={boot.data}
                                        onReload={load}
                                        onOpenSettings={() => handleTabChange("settings")}
                                        onOpenRequests={() => handleTabChange("requests")}
                                        onOpenPlans={() => handleTabChange("plans")}
                                    />
                                )}

                                {tab === "requests" && (
                                    <RequestsPage boot={boot.data} />
                                )}

                                {tab === "settings" && (
                                    <SettingsPage
                                        boot={boot.data}
                                        onReload={load}
                                        onDirtyChange={setSettingsDirty}
                                    />
                                )}

                                {tab === "plans" && (
                                    <PlansPage
                                        boot={boot.data}
                                        onReload={load}
                                    />
                                )}

                                {tab === "help" && (
                                    <HelpPage />
                                )}
                            </>
                        )}
                    </>
                )}
            </Frame>
        </AppProvider>
    );
}
