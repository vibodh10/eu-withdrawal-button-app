-- This migration is the one-time entitlement cutover. Apply it before the
-- Partner-API-aware application release. Shops installed after this statement
-- runs are not grandfathered because the new columns default to NULL.
ALTER TABLE "Shop"
ADD COLUMN "grandfatheredFreeAt" TIMESTAMP(3),
ADD COLUMN "grandfatheredFreeRevokedAt" TIMESTAMP(3),
ADD COLUMN "shopifyShopId" TEXT,
ADD COLUMN "billingVersion" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "Shop_shopifyShopId_key" ON "Shop"("shopifyShopId");

-- Only installed merchants actually receiving the legacy BASIC entitlement at
-- cutover are grandfathered. Existing uninstall tombstones are intentionally
-- excluded by business decision.
UPDATE "Shop"
SET "grandfatheredFreeAt" = CURRENT_TIMESTAMP
WHERE "plan" = 'BASIC'
  AND "uninstalledAt" IS NULL;

ALTER TABLE "Shop"
ALTER COLUMN "plan" SET DEFAULT 'PAYMENT_REQUIRED';

ALTER TABLE "Shop"
ADD CONSTRAINT "Shop_grandfather_revocation_requires_grant_check"
CHECK (
  "grandfatheredFreeRevokedAt" IS NULL
  OR "grandfatheredFreeAt" IS NOT NULL
);

-- Grandfathering is granted only by the snapshot above. It cannot be added to
-- new rows or changed later. Revocation is a one-way NULL -> timestamp change.
CREATE OR REPLACE FUNCTION "enforce_shop_grandfathered_free_monotonic"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW."grandfatheredFreeAt" IS NOT NULL THEN
    RAISE EXCEPTION 'grandfathered Free can only be granted by the cutover snapshot';
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW."grandfatheredFreeAt" IS DISTINCT FROM OLD."grandfatheredFreeAt" THEN
    RAISE EXCEPTION 'grandfathered Free grant is immutable';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD."grandfatheredFreeRevokedAt" IS NOT NULL
     AND NEW."grandfatheredFreeRevokedAt" IS DISTINCT FROM OLD."grandfatheredFreeRevokedAt" THEN
    RAISE EXCEPTION 'grandfathered Free revocation is irreversible';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "Shop_grandfathered_free_monotonic"
BEFORE INSERT OR UPDATE ON "Shop"
FOR EACH ROW
EXECUTE FUNCTION "enforce_shop_grandfathered_free_monotonic"();
