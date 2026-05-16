import { useEffect, useMemo, useState } from "react";
import {
    AppProvider,
    Frame,
    Navigation,
    TopBar,
    Page,
    Card,
    Text,
    Spinner
} from "@shopify/polaris";
import {
    HomeIcon,
    OrderIcon,
    SettingsIcon,
    ProductIcon
} from "@shopify/polaris-icons";

import {apiGet, syncBilling} from "./api";
import DashboardPage from "./pages/DashboardPage.jsx";
import RequestsPage from "./pages/RequestsPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import PlansPage from "./pages/PlansPage.jsx";
import DpaPage from "./pages/DpaPage.jsx";
import {useAppBridge} from "@shopify/app-bridge-react";
import {Redirect} from "@shopify/app-bridge/actions";

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

    const title = useMemo(() => {
        const active = tabs.find((item) => item.key === tab);
        return active ? active.label : "Dashboard";
    }, [tab]);

    async function load() {
        try {
            setBoot((prev) => ({
                ...prev,
                loading: true,
                error: ""
            }));

            const data = await apiGet("/admin/me");

            setBoot({
                loading: false,
                error: "",
                data
            });

        } catch (err) {
            alert("CATCH RUNNING");

            console.log(err);

            if (err.status === 401) {
                alert("401 FOUND");

                window.location.href = err.data.redirectTo;
                return;
            }

            alert("NOT 401");
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
                    onClick: () => setTab(item.key)
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
                        <Card>
                            <Spinner accessibilityLabel="Loading" size="large" />
                        </Card>
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
                                    <DashboardPage boot={boot.data} />
                                )}
                                {tab === "requests" && (
                                    <RequestsPage boot={boot.data} />
                                )}
                                {tab === "settings" && (
                                    <SettingsPage boot={boot.data} onReload={load} />
                                )}
                                {tab === "plans" && (
                                    <PlansPage boot={boot.data} onReload={load} />
                                )}
                            </>
                        )}
                    </>
                )}
            </Frame>
        </AppProvider>
    );
}