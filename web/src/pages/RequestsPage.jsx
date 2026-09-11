import { useEffect, useRef, useState } from "react";
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
import {apiGet, apiSend, getAuthHeaders} from "../api";

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
                tooltip: "Order found and within the withdrawal period",
            };

        case "NOT_FOUND":
            return {
                tone: "critical",
                label: "Order not found",
                tooltip: "No matching order was found in Shopify",
            };

        case "EXPIRED":
            return {
                tone: "critical",
                label: "Period expired",
                tooltip: "Order found, but the withdrawal period has expired",
            };

        case "ERROR":
            return {
                tone: "warning",
                label: "Unavailable",
                tooltip: "Could not verify the order because of a Shopify or API issue",
            };

        default:
            return {
                tone: "info",
                label: "Not verified",
                tooltip: "Automatic order verification is available on Pro",
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

    const tableScrollRef = useRef(null);
    const [scrollPos, setScrollPos] = useState(0);
    const [scrollMax, setScrollMax] = useState(0);
    const [scrollViewport, setScrollViewport] = useState(0);
    const [scrollContent, setScrollContent] = useState(0);

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

    const thumbPercent =
        scrollContent > 0
            ? Math.max(16, Math.min(100, (scrollViewport / scrollContent) * 100))
            : 100;

    const thumbLeftPercent =
        scrollMax > 0
            ? (scrollPos / scrollMax) * (100 - thumbPercent)
            : 0;

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

        setRows((prev) =>
            prev.filter((row) => !idsToDelete.includes(row.id))
        );

        setBulkDeleteModalOpen(false);

        try {
            await load();
        } catch (e) {
            console.error("Reload failed", e);
        }
    }

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

    useEffect(() => {
        const el = tableScrollRef.current;
        if (!el || loading) return;

        const update = () => {
            setScrollMax(Math.max(0, el.scrollWidth - el.clientWidth));
            setScrollPos(el.scrollLeft);
            setScrollViewport(el.clientWidth);
            setScrollContent(el.scrollWidth);
        };

        update();

        const frame = requestAnimationFrame(update);
        window.addEventListener("resize", update);

        let observer;
        if (typeof ResizeObserver !== "undefined") {
            observer = new ResizeObserver(update);
            observer.observe(el);

            if (el.firstElementChild) {
                observer.observe(el.firstElementChild);
            }
        }

        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener("resize", update);
            observer?.disconnect();
        };
    }, [loading, filteredRows.length]);

    async function updateStatus(id, status) {
        setUpdatingId(id);

        try {
            await apiSend(`/admin/requests/${id}`, "PATCH", { status });

            setRows((currentRows) =>
                currentRows.map((row) =>
                    row.id === id
                        ? { ...row, status }
                        : row
                )
            );
        } catch (error) {
            console.error(error);
            alert("Could not update the request status.");
        } finally {
            setUpdatingId(null);
        }
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

    function truncate(value, max = 24) {
        if (!value) return "—";
        return value.length > max ? value.slice(0, max) + "…" : value;
    }

    function moveTableTo(value) {
        const el = tableScrollRef.current;
        if (!el) return;

        const next = Math.max(0, Math.min(scrollMax, value));
        el.scrollLeft = next;
        setScrollPos(next);
    }

    function handleTrackPointerDown(e) {
        if (e.target !== e.currentTarget || scrollMax <= 0) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const thumbWidth = rect.width * (thumbPercent / 100);
        const usableWidth = rect.width - thumbWidth;

        if (usableWidth <= 0) return;

        const targetLeft = Math.max(
            0,
            Math.min(
                usableWidth,
                e.clientX - rect.left - thumbWidth / 2
            )
        );

        moveTableTo((targetLeft / usableWidth) * scrollMax);
    }

    function handleThumbPointerDown(e) {
        e.preventDefault();
        e.stopPropagation();

        const thumb = e.currentTarget;
        thumb.dataset.dragging = "true";
        thumb.dataset.startX = String(e.clientX);
        thumb.dataset.startScroll = String(scrollPos);
        thumb.setPointerCapture?.(e.pointerId);
    }

    function handleThumbPointerMove(e) {
        const thumb = e.currentTarget;
        if (thumb.dataset.dragging !== "true") return;

        const track = thumb.parentElement;
        if (!track) return;

        const usableWidth = track.clientWidth - thumb.offsetWidth;
        if (usableWidth <= 0) return;

        const startX = Number(thumb.dataset.startX);
        const startScroll = Number(thumb.dataset.startScroll);
        const deltaX = e.clientX - startX;

        moveTableTo(startScroll + (deltaX / usableWidth) * scrollMax);
    }

    function handleThumbPointerUp(e) {
        const thumb = e.currentTarget;
        thumb.dataset.dragging = "false";

        if (thumb.hasPointerCapture?.(e.pointerId)) {
            thumb.releasePointerCapture(e.pointerId);
        }
    }

    function handleScrollbarKeyDown(e) {
        if (scrollMax <= 0) return;

        const step = Math.max(80, scrollViewport * 0.2);

        if (e.key === "ArrowRight") {
            e.preventDefault();
            moveTableTo(scrollPos + step);
        } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            moveTableTo(scrollPos - step);
        } else if (e.key === "Home") {
            e.preventDefault();
            moveTableTo(0);
        } else if (e.key === "End") {
            e.preventDefault();
            moveTableTo(scrollMax);
        }
    }

    return (
        <>
            <style>{`
                .requests-table-scroll {
                    overflow-x: auto;
                    width: 100%;
                    scrollbar-width: none;
                    -ms-overflow-style: none;
                }

                .requests-table-scroll::-webkit-scrollbar {
                    display: none;
                    height: 0;
                }

                .requests-big-scroll-track {
                    position: relative;
                    height: 34px;
                    margin: 6px 12px 10px;
                    background: #d7d7d7;
                    border: 1px solid #b8b8b8;
                    border-radius: 999px;
                    box-sizing: border-box;
                    cursor: pointer;
                    user-select: none;
                    touch-action: none;
                }

                .requests-big-scroll-thumb {
                    position: absolute;
                    top: 4px;
                    bottom: 4px;
                    background: #5c5c5c;
                    border-radius: 999px;
                    cursor: grab;
                    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
                    touch-action: none;
                }

                .requests-big-scroll-thumb:hover {
                    background: #444;
                }

                .requests-big-scroll-thumb:active {
                    cursor: grabbing;
                    background: #333;
                }

                .requests-big-scroll-track:focus-visible {
                    outline: 2px solid #005bd3;
                    outline-offset: 2px;
                }
            `}</style>

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
                                                { label: "Period expired", value: "EXPIRED" },
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
                                <div
                                    style={{
                                        minHeight: "420px",
                                        padding: "40px",
                                        display: "flex",
                                        justifyContent: "center",
                                        alignItems: "flex-start",
                                    }}
                                >
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
                                <div>
                                    <div
                                        ref={tableScrollRef}
                                        className="requests-table-scroll"
                                        onScroll={(e) => setScrollPos(e.currentTarget.scrollLeft)}
                                    >
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
                                                                <Tooltip content={row.customerName || "Unknown"}>
                                                                    <Text fontWeight="medium">
                                                                        {truncate(row.customerName || "Unknown", 24)}
                                                                    </Text>
                                                                </Tooltip>

                                                                <Tooltip content={row.customerEmail || ""}>
                                                                    <Text tone="subdued" variant="bodySm">
                                                                        {truncate(row.customerEmail, 30)}
                                                                    </Text>
                                                                </Tooltip>
                                                            </BlockStack>
                                                        </IndexTable.Cell>

                                                        <IndexTable.Cell>
                                                            <Tooltip content={row.orderNumber || row.orderId || "—"}>
                                                                <Text as="span">
                                                                    {truncate(row.orderNumber || row.orderId, 20)}
                                                                </Text>
                                                            </Tooltip>
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
                                    </div>

                                    {scrollMax > 0 && (
                                        <div
                                            className="requests-big-scroll-track"
                                            role="scrollbar"
                                            aria-label="Scroll withdrawal requests horizontally"
                                            aria-orientation="horizontal"
                                            aria-valuemin={0}
                                            aria-valuemax={Math.round(scrollMax)}
                                            aria-valuenow={Math.round(scrollPos)}
                                            tabIndex={0}
                                            onPointerDown={handleTrackPointerDown}
                                            onKeyDown={handleScrollbarKeyDown}
                                        >
                                            <div
                                                className="requests-big-scroll-thumb"
                                                style={{
                                                    width: `${thumbPercent}%`,
                                                    left: `${thumbLeftPercent}%`,
                                                }}
                                                onPointerDown={handleThumbPointerDown}
                                                onPointerMove={handleThumbPointerMove}
                                                onPointerUp={handleThumbPointerUp}
                                                onPointerCancel={handleThumbPointerUp}
                                            />
                                        </div>
                                    )}
                                </div>
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
        </>
    );
}