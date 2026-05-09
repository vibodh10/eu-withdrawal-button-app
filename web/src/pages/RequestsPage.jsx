import { useEffect, useState } from "react";
import {
    Page,
    Layout,
    Card,
    Text,
    IndexTable,
    Select,
    Spinner,
    Badge,
    Button,
    Tooltip,
    TextField,
    InlineStack,
    BlockStack
} from "@shopify/polaris";
import { apiGet, apiSend, getAuthHeaders } from "../api";

const statuses = ["RECEIVED", "CONFIRMED", "REVIEWED", "APPROVED", "REJECTED"];

function statusTone(status) {
    switch (status) {
        case "APPROVED":
            return "success";
        case "REJECTED":
            return "critical";
        case "REVIEWED":
            return "attention";
        default:
            return "info";
    }
}

function getVerificationUI(status) {
    switch (status) {
        case "VERIFIED":
            return {
                tone: "success",
                label: "Verified",
                tooltip: "Order found and within withdrawal period",
            };
        case "NOT_FOUND":
            return {
                tone: "critical",
                label: "Invalid order",
                tooltip: "Order not found in Shopify",
            };
        case "ERROR":
            return {
                tone: "warning",
                label: "Unavailable",
                tooltip: "Could not verify order (Shopify/API issue)",
            };
        default:
            return {
                tone: "info",
                label: "Not verified",
                tooltip: "Automatic verification available on Pro",
            };
    }
}

export default function RequestsPage() {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [updatingId, setUpdatingId] = useState(null);
    const [isPro, setIsPro] = useState(false);

    const [filters, setFilters] = useState({
        status: "",
        verification: "",
        search: ""
    });

    const filteredRows = rows.filter((row) => {
        if (filters.status && row.status !== filters.status) return false;
        if (filters.verification && row.verificationStatus !== filters.verification) return false;

        if (filters.search) {
            const s = filters.search.toLowerCase();
            return (
                row.customerEmail?.toLowerCase().includes(s) ||
                row.customerName?.toLowerCase().includes(s) ||
                row.orderNumber?.toLowerCase().includes(s) ||
                row.publicReference?.toLowerCase().includes(s)
            );
        }

        return true;
    });

    async function load() {
        setLoading(true);
        const [requestsData, meData] = await Promise.all([
            apiGet("/admin/requests"),
            apiGet("/admin/me"),
        ]);

        setRows(requestsData.requests || []);
        setIsPro(meData.isPro);
        setLoading(false);
    }

    useEffect(() => {
        load();
    }, []);

    async function updateStatus(id, status) {
        setUpdatingId(id);
        await apiSend(`/admin/requests/${id}`, "PATCH", { status });
        await load();
        setUpdatingId(null);
    }

    async function exportCSV() {
        if (!isPro) return;

        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/admin/export.csv", { headers });

            if (!res.ok) throw new Error();

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);

            const a = document.createElement("a");
            a.href = url;
            a.download = "withdrawal-requests.csv";
            a.click();

            window.URL.revokeObjectURL(url);
        } catch {
            alert("Failed to export CSV");
        }
    }

    return (
        <Page
            title="Withdrawal requests"
            primaryAction={{
                content: "Export CSV",
                onAction: exportCSV,
                disabled: !isPro
            }}
        >
            <Layout>
                <Layout.Section>

                    <Card padding="0">

                        {/* 🔹 Filters */}
                        {isPro && (
                            <div style={{ padding: "16px", borderBottom: "1px solid #eee" }}>
                                <InlineStack gap="300" wrap>

                                    <Select
                                        label="Status"
                                        options={[
                                            { label: "All", value: "" },
                                            ...statuses.map(s => ({ label: s, value: s }))
                                        ]}
                                        value={filters.status}
                                        onChange={(v) => setFilters(prev => ({ ...prev, status: v }))}
                                    />

                                    <Select
                                        label="Verification"
                                        options={[
                                            { label: "All", value: "" },
                                            { label: "Verified", value: "VERIFIED" },
                                            { label: "Invalid order", value: "NOT_FOUND" },
                                            { label: "Unavailable", value: "ERROR" },
                                        ]}
                                        value={filters.verification}
                                        onChange={(v) => setFilters(prev => ({ ...prev, verification: v }))}
                                    />

                                    <TextField
                                        label="Search"
                                        placeholder="Email, order, reference..."
                                        value={filters.search}
                                        onChange={(v) => setFilters(prev => ({ ...prev, search: v }))}
                                        autoComplete="off"
                                    />

                                </InlineStack>
                            </div>
                        )}

                        {/* 🔄 Loading */}
                        {loading && (
                            <div style={{ padding: "40px", textAlign: "center" }}>
                                <Spinner size="large" />
                            </div>
                        )}

                        {/* ❌ Empty */}
                        {!loading && filteredRows.length === 0 && (
                            <div style={{ padding: "40px", textAlign: "center" }}>
                                <Text tone="subdued">No requests found.</Text>
                            </div>
                        )}

                        {/* ✅ Table */}
                        {!loading && filteredRows.length > 0 && (
                            <IndexTable
                                resourceName={{ singular: "request", plural: "requests" }}
                                itemCount={filteredRows.length}
                                headings={[
                                    { title: "Reference" },
                                    { title: "Customer" },
                                    { title: "Order" },
                                    { title: "Verification" },
                                    { title: "Status" },
                                    { title: "Submitted" },
                                    { title: "Actions" },
                                ]}
                            >
                                {filteredRows.map((row, index) => {
                                    const verification = getVerificationUI(row.verificationStatus);

                                    return (
                                        <IndexTable.Row id={row.id} key={row.id} position={index}>

                                            <IndexTable.Cell>
                                                <Text fontWeight="medium">{row.publicReference}</Text>
                                            </IndexTable.Cell>

                                            <IndexTable.Cell>
                                                <BlockStack gap="050">
                                                    <Text fontWeight="medium">{row.customerName || "Unknown"}</Text>
                                                    <Text tone="subdued" variant="bodySm">{row.customerEmail}</Text>
                                                </BlockStack>
                                            </IndexTable.Cell>

                                            <IndexTable.Cell>
                                                {row.orderNumber || row.orderId || "—"}
                                            </IndexTable.Cell>

                                            <IndexTable.Cell>
                                                <Tooltip content={verification.tooltip}>
                                                    <Badge tone={verification.tone}>{verification.label}</Badge>
                                                </Tooltip>
                                            </IndexTable.Cell>

                                            <IndexTable.Cell>
                                                <InlineStack gap="200" align="center"><Select
                                                        options={statuses.map(s => ({ label: s, value: s }))}
                                                        value={row.status}
                                                        onChange={(value) => updateStatus(row.id, value)}
                                                        disabled={updatingId === row.id}
                                                    />
                                                </InlineStack>
                                            </IndexTable.Cell>

                                            <IndexTable.Cell>
                                                {new Date(row.createdAt).toLocaleString()}
                                            </IndexTable.Cell>

                                            <IndexTable.Cell>
                                                <Button
                                                    tone="critical"
                                                    size="slim"
                                                    onClick={async () => {
                                                        if (!confirm(`Delete data for ${row.customerEmail}?`)) return;

                                                        const headers = await getAuthHeaders();

                                                        await fetch("/admin/delete-customer", {
                                                            method: "DELETE",
                                                            headers: {
                                                                ...headers,
                                                                "Content-Type": "application/json"
                                                            },
                                                            body: JSON.stringify({ email: row.customerEmail })
                                                        });

                                                        load();
                                                    }}
                                                >
                                                    Delete Customer Data
                                                </Button>
                                            </IndexTable.Cell>

                                        </IndexTable.Row>
                                    );
                                })}
                            </IndexTable>
                        )}
                    </Card>

                    {!isPro && (
                        <div style={{ padding: "12px 20px" }}>
                            <Text tone="subdued">
                                Advanced filtering and CSV export are available on Pro.
                            </Text>
                        </div>
                    )}

                </Layout.Section>
            </Layout>
        </Page>
    );
}