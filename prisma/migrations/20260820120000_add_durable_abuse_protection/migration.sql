-- These records are deliberately independent of Shop so uninstall/reinstall
-- cannot clear a merchant's limits or delivery-decision history.
CREATE TABLE "AbuseCounter" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowSeconds" INTEGER NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AbuseCounter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AbuseConcurrencyLease" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "shopKey" TEXT,
    "provider" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AbuseConcurrencyLease_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailDeliveryDecision" (
    "id" TEXT NOT NULL,
    "withdrawalRequestId" TEXT,
    "shopDomain" TEXT,
    "recipientHash" TEXT,
    "provider" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailDeliveryDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AbuseCounter_category_scope_scopeKey_windowStart_key"
ON "AbuseCounter"("category", "scope", "scopeKey", "windowStart");
CREATE INDEX "AbuseCounter_category_updatedAt_idx"
ON "AbuseCounter"("category", "updatedAt");
CREATE INDEX "AbuseConcurrencyLease_category_expiresAt_idx"
ON "AbuseConcurrencyLease"("category", "expiresAt");
CREATE INDEX "AbuseConcurrencyLease_category_shopKey_expiresAt_idx"
ON "AbuseConcurrencyLease"("category", "shopKey", "expiresAt");
CREATE INDEX "AbuseConcurrencyLease_category_provider_expiresAt_idx"
ON "AbuseConcurrencyLease"("category", "provider", "expiresAt");
CREATE INDEX "EmailDeliveryDecision_withdrawalRequestId_createdAt_idx"
ON "EmailDeliveryDecision"("withdrawalRequestId", "createdAt");
CREATE INDEX "EmailDeliveryDecision_shopDomain_createdAt_idx"
ON "EmailDeliveryDecision"("shopDomain", "createdAt");
CREATE INDEX "EmailDeliveryDecision_status_createdAt_idx"
ON "EmailDeliveryDecision"("status", "createdAt");
