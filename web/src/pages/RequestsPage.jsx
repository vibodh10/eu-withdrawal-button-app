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
    BlockStack,
    Modal,
    useIndexResourceState
} from "@shopify/polaris";
import { apiGet, apiSend } from "../api";

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
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [bulkDeleteModalOpen, setBulkDeleteModalOpen] = useState(false);

    async function deleteSelected() {
        const idsToDelete = [...selectedResources];

        try {
            await Promise.all(
                idsToDelete.map((id) =>
                    apiSend(`/admin/requests/${id}`, "DELETE")
                )
            );
        } catch (err) {
            console.error(err);

            alert(
                "Temporary server issue. Please try again in a few moments."
            );

            return;
        }

        // ✅ instantly update UI
        setRows((prev) =>
            prev.filter((row) => !idsToDelete.includes(row.id))
        );

        // ✅ close modal immediately
        setBulkDeleteModalOpen(false);

        // ✅ background refresh only
        try {
            await load();
        } catch (e) {
            console.error("Reload failed", e);
        }
    }

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

    const {
        selectedResources,
        allResourcesSelected,
        handleSelectionChange,
    } = useIndexResourceState(filteredRows);

    async function load() {
        try {
            setLoading(true);

            const [requestsData, meData] = await Promise.all([
                apiGet("/admin/requests"),
                apiGet("/admin/me"),
            ]);

            setRows(requestsData.requests || []);
            setIsPro(meData.isPro);

        } finally {
            setLoading(false);
        }
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
        } catch (err) {
            console.error(err);

            alert(
                "Could not export CSV right now. Please try again shortly."
            );
        }
    }

    async function confirmDeleteCustomer() {
        if (!selectedCustomer) return;

        try {
            await apiSend("/admin/delete-customer", "DELETE", {
                email: selectedCustomer.customerEmail,
            });

            setDeleteModalOpen(false);
            setSelectedCustomer(null);

            await load();
        } catch (err) {
            console.error(err);

            alert(
                "Temporary server issue. Please try again in a few moments."
            );
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
                                selectedItemsCount={
                                    allResourcesSelected ? "All" : selectedResources.length
                                }
                                onSelectionChange={handleSelectionChange}
                                promotedBulkActions={[
                                    {
                                        content: "Delete selected",
                                        destructive: true,
                                        onAction: () => setBulkDeleteModalOpen(true),
                                    },
                                ]}
                                headings={[
                                    { title: "Reference" },
                                    { title: "Customer" },
                                    { title: "Order" },
                                    { title: "Verification" },
                                    { title: "Reason" },
                                    { title: "Status" },
                                    { title: "Submitted" },
                                    { title: "Actions" },
                                ]}
                            >
                                {filteredRows.map((row, index) => {
                                    const verification = getVerificationUI(row.verificationStatus);

                                    return (
                                        <IndexTable.Row
                                            id={row.id}
                                            key={row.id}
                                            position={index}
                                            selected={selectedResources.includes(row.id)}
                                        >

                                            <IndexTable.Cell>
                                                <Text fontWeight="medium">
                                                    {row.publicReference}
                                                </Text>
                                            </IndexTable.Cell>

                                            <IndexTable.Cell>
                                                <BlockStack gap="050">
                                                    <Text fontWeight="medium">
                                                        {row.customerName || "Unknown"}
                                                    </Text>

                                                    <Text tone="subdued" variant="bodySm">
                                                        {row.customerEmail}
                                                    </Text>
                                                </BlockStack>
                                            </IndexTable.Cell>

                                            <IndexTable.Cell>
                                                {row.orderNumber || row.orderId || "—"}
                                            </IndexTable.Cell>

                                            <IndexTable.Cell>
                                                <Tooltip content={verification.tooltip}>
                                                    <Badge tone={verification.tone}>
                                                        {verification.label}
                                                    </Badge>
                                                </Tooltip>
                                            </IndexTable.Cell>

                                            <IndexTable.Cell>
                                                <Tooltip content={row.reason || "No reason provided"}>
                                                    <Text
                                                        as="span"
                                                        variant="bodySm"
                                                        tone="subdued"
                                                    >
                                                        {row.reason
                                                            ? row.reason.length > 28
                                                                ? row.reason.slice(0, 28) + "..."
                                                                : row.reason
                                                            : "—"}
                                                    </Text>
                                                </Tooltip>
                                            </IndexTable.Cell>

                                            <IndexTable.Cell>
                                                <Select
                                                    options={statuses.map((s) => ({
                                                        label: s,
                                                        value: s
                                                    }))}
                                                    value={row.status}
                                                    onChange={(value) =>
                                                        updateStatus(row.id, value)
                                                    }
                                                    disabled={updatingId === row.id}
                                                />
                                            </IndexTable.Cell>

                                            <IndexTable.Cell>
                                                {new Date(row.createdAt).toLocaleString()}
                                            </IndexTable.Cell>

                                            <IndexTable.Cell>
                                                <Button
                                                    tone="critical"
                                                    size="slim"
                                                    onClick={() => {
                                                        setSelectedCustomer(row);
                                                        setDeleteModalOpen(true);
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

            <Modal
                open={deleteModalOpen}
                onClose={() => {
                    setDeleteModalOpen(false);
                    setSelectedCustomer(null);
                }}
                title="Delete customer data"
                primaryAction={{
                    content: "Delete",
                    destructive: true,
                    onAction: confirmDeleteCustomer,
                }}
                secondaryActions={[
                    {
                        content: "Cancel",
                        onAction: () => {
                            setDeleteModalOpen(false);
                            setSelectedCustomer(null);
                        },
                    },
                ]}
            >
                <Modal.Section>
                    <Text as="p">
                        This will permanently delete all stored withdrawal data for{" "}
                        <strong>{selectedCustomer?.customerEmail}</strong>.
                    </Text>
                </Modal.Section>
            </Modal>

            <Modal
                open={bulkDeleteModalOpen}
                onClose={() => setBulkDeleteModalOpen(false)}
                title="Delete selected requests"
                primaryAction={{
                    content: "Delete requests",
                    destructive: true,
                    onAction: deleteSelected,
                }}
                secondaryActions={[
                    {
                        content: "Cancel",
                        onAction: () => setBulkDeleteModalOpen(false),
                    },
                ]}
            >
                <Modal.Section>
                    <Text as="p">
                        This will permanently delete{" "}
                        <strong>{selectedResources.length}</strong>{" "}
                        selected withdrawal request(s).
                    </Text>
                </Modal.Section>
            </Modal>
        </Page>
    );
}