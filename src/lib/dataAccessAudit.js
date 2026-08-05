import { prisma } from "./db.js";

export async function recordDataAccess({
                                           db = prisma,
                                           shopId = null,
                                           action,
                                           recordId = null,
                                           recordCount = null,
                                           actorType,
                                           reason = null,
                                       }) {
    if (!action || !actorType) {
        throw new Error(
            "Audit action and actorType are required."
        );
    }

    return db.dataAccessAudit.create({
        data: {
            shopId,
            action,
            recordId,
            recordCount,
            actorType,
            reason,
        },
    });
}