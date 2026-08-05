-- CreateTable
CREATE TABLE "DataAccessAudit" (
    "id" TEXT NOT NULL,
    "shopId" TEXT,
    "action" TEXT NOT NULL,
    "recordId" TEXT,
    "recordCount" INTEGER,
    "actorType" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataAccessAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataAccessAudit_shopId_createdAt_idx" ON "DataAccessAudit"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "DataAccessAudit_action_createdAt_idx" ON "DataAccessAudit"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "DataAccessAudit" ADD CONSTRAINT "DataAccessAudit_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
