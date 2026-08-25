-- DEPLOYMENT SAFETY: apply this migration only while every application and
-- cron replica is drained. See docs/deployment/shopify-auth-cas-railway.md.
-- A normal rolling deployment is unsafe because pre-migration workers do not
-- participate in the authVersion protocol.

-- Monotonic generation used for compare-and-set Shopify credential writes,
-- plus the durable owner of a single at-most-once refresh attempt.
ALTER TABLE "Shop"
ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "tokenRefreshClaimId" TEXT,
ADD COLUMN "tokenRefreshClaimedAt" TIMESTAMP(3);
