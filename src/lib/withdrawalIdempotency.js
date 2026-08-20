import crypto from "node:crypto";

export function buildWithdrawalSubmissionKey(shopDomain, orderId) {
    const normalizedShop = String(shopDomain || "").trim().toLowerCase();
    const normalizedOrderId = String(orderId || "").trim();
    if (!normalizedShop || !normalizedOrderId) {
        throw new Error("Withdrawal submission identity is incomplete.");
    }
    return crypto.createHash("sha256")
        .update(`${normalizedShop}:${normalizedOrderId}`)
        .digest("hex");
}

export async function findExistingWithdrawalRequest(
    prismaClient,
    shopId,
    submittedOrderNumber,
    submittedEmail
) {
    const withoutHash = String(submittedOrderNumber || "")
        .trim()
        .replace(/^#/, "");
    const normalizedEmail = String(submittedEmail || "")
        .trim()
        .toLowerCase();
    if (!withoutHash || !normalizedEmail) return null;

    return prismaClient.withdrawalRequest.findFirst({
        where: {
            shopId,
            customerEmail: normalizedEmail,
            orderNumber: {
                in: [withoutHash, `#${withoutHash}`],
            },
        },
        orderBy: { createdAt: "desc" },
        select: {
            publicReference: true,
            status: true,
        },
    });
}
