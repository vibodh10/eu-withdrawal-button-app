
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

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
    useIndexResourceState,
} from "@shopify/polaris";

import {
    apiGet,
    apiSend,
    getAuthHeaders,
} from "../api";

const STATUSES = [
    "RECEIVED",
    "CONFIRMED",
    "REVIEWED",
    "APPROVED",
    "REJECTED",
];

const VERIFICATION_TONES = {
    VERIFIED: "success",
    NOT_FOUND: "critical",
    EXPIRED: "critical",
    ERROR: "warning",
    UNVERIFIED: "info",
};

function getVerificationUI(status, t) {
    const key = Object.hasOwn(VERIFICATION_TONES, status)
        ? status
        : "UNVERIFIED";

    return {
        tone: VERIFICATION_TONES[key],
        label: t(`requests.verificationStates.${key}.label`),
        tooltip: t(`requests.verificationStates.${key}.tooltip`),
    };
}

function truncate(value, max = 24) {
    if (!value) return "—";

    return value.length > max
        ? `${value.slice(0, max)}…`
        : value;
}

export default function RequestsPage() {
    const { t, i18n } = useTranslation();

    const dateLocale =
        i18n.resolvedLanguage === "de"
            ? "de-DE"
            : "en-GB";

    const statusOptions = STATUSES.map((status) => ({
        label: t(`requests.statuses.${status}`),
        value: status,
    }));

    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [updatingId, setUpdatingId] = useState(null);
    const [isPro, setIsPro] = useState(false);

    const [deleteModalOpen, setDeleteModalOpen] =
        useState(false);

    const [selectedCustomer, setSelectedCustomer] =
        useState(null);

    const [bulkDeleteModalOpen, setBulkDeleteModalOpen] =
        useState(false);

    const [filters, setFilters] = useState({
        status: "",
        verification: "",
        search: "",
    });

    const tableScrollRef = useRef(null);

    const [scrollPos, setScrollPos] = useState(0);
    const [scrollMax, setScrollMax] = useState(0);
    const [scrollViewport, setScrollViewport] = useState(0);
    const [scrollContent, setScrollContent] = useState(0);

    // Filtering uses internal status codes, not translations.
    const filteredRows = rows.filter((row) => {
        if (
            filters.status &&
            row.status !== filters.status
        ) {
            return false;
        }

        if (
            filters.verification &&
            row.verificationStatus !== filters.verification
        ) {
            return false;
        }

        if (filters.search) {
            const search = filters.search.toLowerCase();

            return (
                row.customerEmail
                    ?.toLowerCase()
                    .includes(search) ||
                row.customerName
                    ?.toLowerCase()
                    .includes(search) ||
                row.orderNumber
                    ?.toLowerCase()
                    .includes(search) ||
                row.publicReference
                    ?.toLowerCase()
                    .includes(search)
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
            ? Math.max(
                16,
                Math.min(
                    100,
                    (scrollViewport / scrollContent) * 100
                )
            )
            : 100;

    const thumbLeftPercent =
        scrollMax > 0
            ? (scrollPos / scrollMax) *
            (100 - thumbPercent)
            : 0;

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

    // Preserve the existing custom horizontal scrollbar.
    useEffect(() => {
        const el = tableScrollRef.current;

        if (!el || loading) return;

        const update = () => {
            setScrollMax(
                Math.max(0, el.scrollWidth - el.clientWidth)
            );

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
            await apiSend(
                `/admin/requests/${id}`,
                "PATCH",
                { status }
            );

            setRows((currentRows) =>
                currentRows.map((row) =>
                    row.id === id
                        ? { ...row, status }
                        : row
                )
            );
        } catch (error) {
            console.error(error);

            alert(t("requests.errors.update"));
        } finally {
            setUpdatingId(null);
        }
    }

    async function exportCSV() {
        if (!isPro) return;

        try {
            const headers = await getAuthHeaders();

            const response = await fetch(
                "/admin/export.csv",
                { headers }
            );

            if (!response.ok) {
                throw new Error("CSV export failed");
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);

            const link = document.createElement("a");

            link.href = url;
            link.download = "withdrawal-requests.csv";
            link.click();

            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error(error);

            alert(t("requests.errors.export"));
        }
    }

    async function confirmDeleteCustomer() {
        if (!selectedCustomer) return;

        try {
            await apiSend(
                "/admin/delete-customer",
                "DELETE",
                {
                    email: selectedCustomer.customerEmail,
                }
            );

            setDeleteModalOpen(false);
            setSelectedCustomer(null);

            await load();
        } catch (error) {
            console.error(error);

            alert(t("requests.errors.temporary"));
        }
    }

    async function deleteSelected() {
        const idsToDelete = [...selectedResources];

        try {
            await Promise.all(
                idsToDelete.map((id) =>
                    apiSend(
                        `/admin/requests/${id}`,
                        "DELETE"
                    )
                )
            );
        } catch (error) {
            console.error(error);

            alert(t("requests.errors.temporary"));
            return;
        }

        setRows((currentRows) =>
            currentRows.filter(
                (row) => !idsToDelete.includes(row.id)
            )
        );

        setBulkDeleteModalOpen(false);

        try {
            await load();
        } catch (error) {
            console.error("Reload failed", error);
        }
    }

    function moveTableTo(value) {
        const el = tableScrollRef.current;

        if (!el) return;

        const next = Math.max(
            0,
            Math.min(scrollMax, value)
        );

        el.scrollLeft = next;
        setScrollPos(next);
    }

    function handleTrackPointerDown(event) {
        if (
            event.target !== event.currentTarget ||
            scrollMax <= 0
        ) {
            return;
        }

        const rect =
            event.currentTarget.getBoundingClientRect();

        const thumbWidth =
            rect.width * (thumbPercent / 100);

        const usableWidth = rect.width - thumbWidth;

        if (usableWidth <= 0) return;

        const targetLeft = Math.max(
            0,
            Math.min(
                usableWidth,
                event.clientX -
                rect.left -
                thumbWidth / 2
            )
        );

        moveTableTo(
            (targetLeft / usableWidth) * scrollMax
        );
    }

    function handleThumbPointerDown(event) {
        event.preventDefault();
        event.stopPropagation();

        const thumb = event.currentTarget;

        thumb.dataset.dragging = "true";
        thumb.dataset.startX = String(event.clientX);
        thumb.dataset.startScroll = String(scrollPos);

        thumb.setPointerCapture?.(event.pointerId);
    }

    function handleThumbPointerMove(event) {
        const thumb = event.currentTarget;

        if (thumb.dataset.dragging !== "true") {
            return;
        }

        const track = thumb.parentElement;

        if (!track) return;

        const usableWidth =
            track.clientWidth - thumb.offsetWidth;

        if (usableWidth <= 0) return;

        const startX = Number(thumb.dataset.startX);

        const startScroll = Number(
            thumb.dataset.startScroll
        );

        const deltaX = event.clientX - startX;

        moveTableTo(
            startScroll +
            (deltaX / usableWidth) * scrollMax
        );
    }

    function handleThumbPointerUp(event) {
        const thumb = event.currentTarget;

        thumb.dataset.dragging = "false";

        if (
            thumb.hasPointerCapture?.(event.pointerId)
        ) {
            thumb.releasePointerCapture(event.pointerId);
        }
    }

    function handleScrollbarKeyDown(event) {
        if (scrollMax <= 0) return;

        const step = Math.max(
            80,
            scrollViewport * 0.2
        );

        if (event.key === "ArrowRight") {
            event.preventDefault();
            moveTableTo(scrollPos + step);
        } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            moveTableTo(scrollPos - step);
        } else if (event.key === "Home") {
            event.preventDefault();
            moveTableTo(0);
        } else if (event.key === "End") {
            event.preventDefault();
            moveTableTo(scrollMax);
        }
    }

    function closeCustomerDeleteModal() {
        setDeleteModalOpen(false);
        setSelectedCustomer(null);
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
                title={t("requests.title")}
                primaryAction={{
                    content: t("requests.exportCSV"),
                    onAction: exportCSV,
                    disabled: !isPro,
                }}
            >
                <Layout>
                    <Layout.Section>
                        <Card padding="0">

                            {/* Filters */}
                            {isPro && (
                                <div
                                    style={{
                                        padding: "16px",
                                        borderBottom: "1px solid #eee",
                                    }}
                                >
                                    <InlineStack gap="300" wrap>

                                        <Select
                                            label={t("requests.status")}
                                            options={[
                                                {
                                                    label: t("requests.all"),
                                                    value: "",
                                                },
                                                ...statusOptions,
                                            ]}
                                            value={filters.status}
                                            onChange={(value) =>
                                                setFilters((previous) => ({
                                                    ...previous,
                                                    status: value,
                                                }))
                                            }
                                        />

                                        <Select
                                            label={t("requests.verification")}
                                            options={[
                                                {
                                                    label: t("requests.all"),
                                                    value: "",
                                                },
                                                {
                                                    label: t(
                                                        "requests.verificationStates.VERIFIED.label"
                                                    ),
                                                    value: "VERIFIED",
                                                },
                                                {
                                                    label: t(
                                                        "requests.verificationFilter.invalidOrder"
                                                    ),
                                                    value: "NOT_FOUND",
                                                },
                                                {
                                                    label: t(
                                                        "requests.verificationStates.EXPIRED.label"
                                                    ),
                                                    value: "EXPIRED",
                                                },
                                                {
                                                    label: t(
                                                        "requests.verificationStates.ERROR.label"
                                                    ),
                                                    value: "ERROR",
                                                },
                                            ]}
                                            value={filters.verification}
                                            onChange={(value) =>
                                                setFilters((previous) => ({
                                                    ...previous,
                                                    verification: value,
                                                }))
                                            }
                                        />

                                        <TextField
                                            label={t("requests.search")}
                                            placeholder={t(
                                                "requests.searchPlaceholder"
                                            )}
                                            value={filters.search}
                                            onChange={(value) =>
                                                setFilters((previous) => ({
                                                    ...previous,
                                                    search: value,
                                                }))
                                            }
                                            autoComplete="off"
                                        />

                                    </InlineStack>
                                </div>
                            )}

                            {/* Loading */}
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

                            {/* Empty state */}
                            {!loading && filteredRows.length === 0 && (
                                <div
                                    style={{
                                        padding: "40px",
                                        textAlign: "center",
                                    }}
                                >
                                    <Text tone="subdued">
                                        {t("requests.empty")}
                                    </Text>
                                </div>
                            )}

                            {/* Requests table */}
                            {!loading && filteredRows.length > 0 && (
                                <div>
                                    <div
                                        ref={tableScrollRef}
                                        className="requests-table-scroll"
                                        onScroll={(event) =>
                                            setScrollPos(
                                                event.currentTarget.scrollLeft
                                            )
                                        }
                                    >
                                        <IndexTable
                                            resourceName={{
                                                singular: t(
                                                    "requests.resourceSingular"
                                                ),
                                                plural: t(
                                                    "requests.resourcePlural"
                                                ),
                                            }}
                                            itemCount={filteredRows.length}
                                            selectedItemsCount={
                                                allResourcesSelected
                                                    ? "All"
                                                    : selectedResources.length
                                            }
                                            onSelectionChange={
                                                handleSelectionChange
                                            }
                                            promotedBulkActions={[
                                                {
                                                    content: t(
                                                        "requests.bulkDelete.button"
                                                    ),
                                                    destructive: true,
                                                    onAction: () =>
                                                        setBulkDeleteModalOpen(true),
                                                },
                                            ]}
                                            headings={[
                                                {
                                                    title: t(
                                                        "requests.columns.reference"
                                                    ),
                                                },
                                                {
                                                    title: t(
                                                        "requests.columns.customer"
                                                    ),
                                                },
                                                {
                                                    title: t(
                                                        "requests.columns.order"
                                                    ),
                                                },
                                                {
                                                    title: t(
                                                        "requests.columns.verification"
                                                    ),
                                                },
                                                {
                                                    title: t(
                                                        "requests.columns.reason"
                                                    ),
                                                },
                                                {
                                                    title: t(
                                                        "requests.columns.status"
                                                    ),
                                                },
                                                {
                                                    title: t(
                                                        "requests.columns.submitted"
                                                    ),
                                                },
                                                {
                                                    title: t(
                                                        "requests.columns.actions"
                                                    ),
                                                },
                                            ]}
                                        >
                                            {filteredRows.map((row, index) => {
                                                const verification =
                                                    getVerificationUI(
                                                        row.verificationStatus,
                                                        t
                                                    );

                                                return (
                                                    <IndexTable.Row
                                                        id={row.id}
                                                        key={row.id}
                                                        position={index}
                                                        selected={selectedResources.includes(
                                                            row.id
                                                        )}
                                                    >
                                                        {/* Reference */}
                                                        <IndexTable.Cell>
                                                            <Text fontWeight="medium">
                                                                {row.publicReference}
                                                            </Text>
                                                        </IndexTable.Cell>

                                                        {/* Customer */}
                                                        <IndexTable.Cell>
                                                            <BlockStack gap="050">

                                                                <Tooltip
                                                                    content={
                                                                        row.customerName ||
                                                                        t("requests.unknown")
                                                                    }
                                                                >
                                                                    <Text fontWeight="medium">
                                                                        {truncate(
                                                                            row.customerName ||
                                                                            t("requests.unknown"),
                                                                            24
                                                                        )}
                                                                    </Text>
                                                                </Tooltip>

                                                                <Tooltip
                                                                    content={
                                                                        row.customerEmail || ""
                                                                    }
                                                                >
                                                                    <Text
                                                                        tone="subdued"
                                                                        variant="bodySm"
                                                                    >
                                                                        {truncate(
                                                                            row.customerEmail,
                                                                            30
                                                                        )}
                                                                    </Text>
                                                                </Tooltip>

                                                            </BlockStack>
                                                        </IndexTable.Cell>

                                                        {/* Order */}
                                                        <IndexTable.Cell>
                                                            <Tooltip
                                                                content={
                                                                    row.orderNumber ||
                                                                    row.orderId ||
                                                                    "—"
                                                                }
                                                            >
                                                                <Text as="span">
                                                                    {truncate(
                                                                        row.orderNumber ||
                                                                        row.orderId,
                                                                        20
                                                                    )}
                                                                </Text>
                                                            </Tooltip>
                                                        </IndexTable.Cell>

                                                        {/* Verification */}
                                                        <IndexTable.Cell>
                                                            <Tooltip
                                                                content={
                                                                    verification.tooltip
                                                                }
                                                            >
                                                                <Badge
                                                                    tone={
                                                                        verification.tone
                                                                    }
                                                                >
                                                                    {verification.label}
                                                                </Badge>
                                                            </Tooltip>
                                                        </IndexTable.Cell>

                                                        {/* Reason */}
                                                        <IndexTable.Cell>
                                                            <Tooltip
                                                                content={
                                                                    row.reason ||
                                                                    t("requests.noReason")
                                                                }
                                                            >
                                                                <Text
                                                                    as="span"
                                                                    variant="bodySm"
                                                                    tone="subdued"
                                                                >
                                                                    {row.reason
                                                                        ? row.reason.length > 28
                                                                            ? `${row.reason.slice(0, 28)}...`
                                                                            : row.reason
                                                                        : "—"}
                                                                </Text>
                                                            </Tooltip>
                                                        </IndexTable.Cell>

                                                        {/* Request status */}
                                                        <IndexTable.Cell>
                                                            <Select
                                                                label={t(
                                                                    "requests.status"
                                                                )}
                                                                labelHidden
                                                                options={statusOptions}
                                                                value={row.status}
                                                                onChange={(value) =>
                                                                    updateStatus(
                                                                        row.id,
                                                                        value
                                                                    )
                                                                }
                                                                disabled={
                                                                    updatingId === row.id
                                                                }
                                                            />
                                                        </IndexTable.Cell>

                                                        {/* Submission date */}
                                                        <IndexTable.Cell>
                                                            {new Date(
                                                                row.createdAt
                                                            ).toLocaleString(
                                                                dateLocale
                                                            )}
                                                        </IndexTable.Cell>

                                                        {/* Delete customer data */}
                                                        <IndexTable.Cell>
                                                            <Button
                                                                tone="critical"
                                                                size="slim"
                                                                onClick={() => {
                                                                    setSelectedCustomer(
                                                                        row
                                                                    );
                                                                    setDeleteModalOpen(
                                                                        true
                                                                    );
                                                                }}
                                                            >
                                                                {t(
                                                                    "requests.deleteCustomer.button"
                                                                )}
                                                            </Button>
                                                        </IndexTable.Cell>

                                                    </IndexTable.Row>
                                                );
                                            })}
                                        </IndexTable>
                                    </div>

                                    {/* Horizontal scrollbar */}
                                    {scrollMax > 0 && (
                                        <div
                                            className="requests-big-scroll-track"
                                            role="scrollbar"
                                            aria-label={t(
                                                "requests.scrollLabel"
                                            )}
                                            aria-orientation="horizontal"
                                            aria-valuemin={0}
                                            aria-valuemax={Math.round(
                                                scrollMax
                                            )}
                                            aria-valuenow={Math.round(
                                                scrollPos
                                            )}
                                            tabIndex={0}
                                            onPointerDown={
                                                handleTrackPointerDown
                                            }
                                            onKeyDown={
                                                handleScrollbarKeyDown
                                            }
                                        >
                                            <div
                                                className="requests-big-scroll-thumb"
                                                style={{
                                                    width: `${thumbPercent}%`,
                                                    left: `${thumbLeftPercent}%`,
                                                }}
                                                onPointerDown={
                                                    handleThumbPointerDown
                                                }
                                                onPointerMove={
                                                    handleThumbPointerMove
                                                }
                                                onPointerUp={
                                                    handleThumbPointerUp
                                                }
                                                onPointerCancel={
                                                    handleThumbPointerUp
                                                }
                                            />
                                        </div>
                                    )}
                                </div>
                            )}

                        </Card>

                        {/* Pro explanation */}
                        {!isPro && (
                            <div
                                style={{
                                    padding: "12px 20px",
                                }}
                            >
                                <Text tone="subdued">
                                    {t("requests.filterPro")}
                                </Text>
                            </div>
                        )}

                    </Layout.Section>
                </Layout>

                {/* Delete customer data modal */}
                <Modal
                    open={deleteModalOpen}
                    onClose={closeCustomerDeleteModal}
                    title={t(
                        "requests.deleteCustomer.title"
                    )}
                    primaryAction={{
                        content: t("requests.delete"),
                        destructive: true,
                        onAction: confirmDeleteCustomer,
                    }}
                    secondaryActions={[
                        {
                            content: t("requests.cancel"),
                            onAction: closeCustomerDeleteModal,
                        },
                    ]}
                >
                    <Modal.Section>
                        <Text as="p">
                            {t(
                                "requests.deleteCustomer.description",
                                {
                                    email:
                                        selectedCustomer?.customerEmail ||
                                        "",
                                }
                            )}
                        </Text>
                    </Modal.Section>
                </Modal>

                {/* Bulk delete modal */}
                <Modal
                    open={bulkDeleteModalOpen}
                    onClose={() =>
                        setBulkDeleteModalOpen(false)
                    }
                    title={t(
                        "requests.bulkDelete.title"
                    )}
                    primaryAction={{
                        content: t(
                            "requests.bulkDelete.confirm"
                        ),
                        destructive: true,
                        onAction: deleteSelected,
                    }}
                    secondaryActions={[
                        {
                            content: t("requests.cancel"),
                            onAction: () =>
                                setBulkDeleteModalOpen(false),
                        },
                    ]}
                >
                    <Modal.Section>
                        <Text as="p">
                            {t(
                                "requests.bulkDelete.description",
                                {
                                    count: selectedResources.length,
                                }
                            )}
                        </Text>
                    </Modal.Section>
                </Modal>

            </Page>
        </>
    );
}
