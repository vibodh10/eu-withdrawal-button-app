import { useEffect, useMemo, useState } from "react";
import {
    AppProvider,
    Frame,
    Navigation,
    TopBar,
    Page,
    Card,
    Text,
    SkeletonBodyText, SkeletonDisplayText, Layout, Grid
} from "@shopify/polaris";
import {
    HomeIcon,
    OrderIcon,
    SettingsIcon,
    ProductIcon
} from "@shopify/polaris-icons";

import { apiGet } from "./api";
import DashboardPage from "./pages/DashboardPage.jsx";
import RequestsPage from "./pages/RequestsPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import PlansPage from "./pages/PlansPage.jsx";
import DpaPage from "./pages/DpaPage.jsx";

const tabs = [
    { key: "dashboard", label: "Dashboard", icon: HomeIcon },
    { key: "requests", label: "Requests", icon: OrderIcon },
    { key: "settings", label: "Settings", icon: SettingsIcon },
    { key: "plans", label: "Plans", icon: ProductIcon }
];

export default function App() {
    const [tab, setTab] = useState("dashboard");
    const [boot, setBoot] = useState({ loading: true, error: "", data: null });
    const [mobileNavActive, setMobileNavActive] = useState(false);
    const [settingsDirty, setSettingsDirty] = useState(false);

    const title = useMemo(() => {
        const active = tabs.find((item) => item.key === tab);
        return active ? active.label : "Dashboard";
    }, [tab]);

    function handleTabChange(nextTab) {
        if (nextTab === tab) {
            return;
        }

        /*
         * Do not let merchants leave Settings while the
         * Contextual Save Bar represents unsaved changes.
         *
         * They must press Save or Discard first.
         */
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

            setBoot({
                loading: false,
                error: "",
                data,
            });
        } catch (err) {
            console.error(err);

            if (err.status === 401) {
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

    const navigation = (
        <Navigation location="/">
            <Navigation.Section
                items={tabs.map((item) => ({
                    label: item.label,
                    icon: item.icon,
                    selected: item.key === tab,
                    onClick: () => handleTabChange(item.key)
                }))}
            />

            <Navigation.Section
                title="Current plan"
                items={[
                    {
                        label: `Plan: ${boot.data?.shop?.plan || "BASIC"}`,
                    },
                    {
                        label: boot.data?.isPro
                            ? "All premium controls enabled"
                            : "Upgrade to unlock Pro controls",
                    }
                ]}
            />
        </Navigation>
    );

    return (
        <AppProvider i18n={{}}>
            <Frame navigation={boot.data?.shop?.dpaAcceptedAt ? navigation : null}>
                {boot.loading && (
                    <Page title={title}>
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
                        ) : (
                            <>
                                {tab === "dashboard" && (
                                    <DashboardPage
                                        boot={boot.data}
                                        onReload={load}
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
                            </>
                        )}
                    </>
                )}
            </Frame>
        </AppProvider>
    );
}