# Shopify App Pricing grandfathering cutover (Railway)

This is a maintenance cutover, not a rolling deployment. Keep the public Free
plan published until the maintenance window; removing it is a manual Partner
Dashboard action and is not performed by this repository.

## Exact cutover cohort

Migration `20260825120000_grandfather_free_pricing` snapshots only rows where
`plan = 'BASIC' AND uninstalledAt IS NULL`. The production read-only audit on
2026-08-25 identified exactly 20 shops; keep the approved domain list from that
audit in the private deployment record rather than committing merchant domains
to the repository. The existing PRO row and all 11 existing uninstall
tombstones are deliberately excluded. A merchant in the cohort keeps the
entitlement across future normal uninstall/reinstall. A verified `shop/redact`
deletes the Shop row and therefore deletes the entitlement.

## Partner Dashboard prerequisites

1. As the Partner organization owner, open **Settings > Partner API clients**.
2. Create a dedicated server-side client with **Manage apps** permission.
3. Record the organization ID from the Partner Dashboard URL and the access
   token. Never expose the token to the browser or commit it.
4. Use the Partner API GraphiQL explorer to confirm the app GID in
   `gid://shopify/App/<id>` form.
5. Record every paid Shopify App Pricing plan handle. The current production
   list is `pro`. Compare the complete Partner Dashboard list with
   `SHOPIFY_APP_PRICING_PAID_HANDLES`; every paid handle must appear exactly
   once, and the legacy `basic` handle must not appear in that variable. Include
   every future paid handle before publishing that plan.
6. Set the following Railway variables on every web, worker, or cron service
   that can run this application code:

   - `SHOPIFY_PARTNER_ORGANIZATION_ID`
   - `SHOPIFY_PARTNER_ACCESS_TOKEN`
   - `SHOPIFY_PARTNER_APP_ID`
   - `SHOPIFY_PARTNER_API_VERSION=2026-07`
   - `SHOPIFY_APP_PRICING_PAID_HANDLES=pro`
   - `SHOPIFY_PAID_ENTITLEMENT_MAX_AGE_MINUTES=60`
   - `SHOPIFY_PRICING_RECONCILE_STALE_AFTER_MINUTES=15`
   - `SHOPIFY_PRICING_RECONCILE_BATCH_SIZE=100`
   - `SHOPIFY_PARTNER_REQUEST_INTERVAL_MS=300`

7. Run `npm run pricing:validate-config` in the linked production environment.
   Compare its normalized paid-handle output with the complete Partner
   Dashboard paid-plan list and stop on any difference.
8. In the Shopify App Pricing redirect configuration, retain the existing App
   Home/return destination. Shopify appends `plan_handle`; the app confirms it
   by querying Partner API and never trusts the parameter itself.

## Exact Railway deployment order

One application release plus one schema migration is required. A separate
compatibility code deploy is not required, but a normal rolling deploy is not
safe for the entitlement cutover.

1. Build and test the exact CAS-aware + pricing-aware commit that will be
   deployed. Record its Git SHA and Railway image/release ID.
2. Confirm the Partner API and pricing freshness variables above exist on every auth/billing-capable
   web, worker, and cron service. Do not continue if a service lacks them.
3. Record every service's replica count, then drain all of those services to
   zero. Disable cron schedules and confirm there are no running jobs.
4. Cancel every queued, staged, or retrying Railway deployment for an older
   commit/image. Disable automatic rollback to an older image for the window.
5. Take a database backup/restore point.
6. Before migration, run this read-only query and compare the ordered results
   with the private 20-domain audit. Stop if the count or any domain differs:

   ```sql
   SELECT "shopDomain"
   FROM "Shop"
   WHERE "plan" = 'BASIC'
     AND "uninstalledAt" IS NULL
   ORDER BY "shopDomain";
   ```

7. From the linked production environment, run `npx prisma migrate deploy`.
   This snapshots the installed BASIC cohort, changes the Shop plan default to
   `PAYMENT_REQUIRED`, adds the billing reconciliation generation, and installs
   the database trigger that makes grant and revocation timestamps
   immutable/monotonic.
8. From the exact tested checkout, run `npm run pricing:reconcile` through the
   linked Railway production environment while every service remains drained.
   This resolves each installed cohort shop's Shopify Shop GID, queries Partner
   API current state and complete paginated history, and permanently revokes
   any legacy row with evidence of a paid activation. Every reconciliation
   verifies the Admin-authenticated app GID/API key and Shop GID/domain against
   the Partner response before any revocation. The command must finish
   with zero failures; do not restore service on partial reconciliation.
9. Run these read-only checks before deploying code:

   ```sql
   SELECT "shopDomain"
   FROM "Shop"
   WHERE "grandfatheredFreeAt" IS NOT NULL
   ORDER BY "shopDomain";

   SELECT count(*)
   FROM "Shop"
   WHERE "grandfatheredFreeAt" IS NOT NULL;
   ```

   Also query `grandfatheredFreeRevokedAt`. Any Partner-history revocation is a
   correct exclusion and must remain revoked. Otherwise, the active result must
   match the private approved list and expected count. Stop on any unexplained
   difference; do not manually grant additional rows.
10. Deploy the exact recorded application release to **every** drained web,
   worker, and cron service. Pin each service to that same SHA/image. Verify the
   configured deployment on every service and verify there is no older queued,
   staged, retrying, or rollback image before restoring any replicas.
11. While services remain drained, manually edit Shopify App Pricing in the
   Partner Dashboard:

   - keep all paid plans and their handles unchanged;
   - remove/unpublish the **public Basic/Free plan**;
   - do not create a private Free replacement;
   - confirm Shopify's hosted plan-selection page exposes only paid plans.

   This step is intentionally manual; the code does not change Partner
   Dashboard pricing.
12. Start one web canary on the recorded release. Verify `/health`, then verify
    with test stores that an existing grandfathered shop reports
    `GRANDFATHERED_FREE`, a new shop reports `PAYMENT_REQUIRED`, and selecting
    Pro is confirmed by Partner API as `PAID` with a durable revocation.
13. Configure the existing authenticated Railway cron caller to `POST`
    `/cron/reconcile-shopify-pricing` every 15 minutes with `x-cron-secret`.
    Confirm one successful run on the canary release. The endpoint processes
    the oldest stale installed shops in a bounded batch and spaces Partner API
    requests by at least 300 ms. Each result is persisted only if its observed
    billing generation and `authVersion` still match and the shop remains
    installed. A conflict is re-read and reconciled again; an uninstall or an
    exhausted conflict is reported as a failed shop, never as a successful
    stale write.
14. Verify every running canary process reports the recorded release. Then
    restore the remaining web/worker/cron replicas and cron schedules to their
    recorded counts, one service at a time. After each restore, verify its live
    SHA/image again.
15. Re-run the cohort count and inspect Partner API reconciliation errors. Do
    not restore an older deployment as rollback: roll forward with a fixed
    build that preserves the migrated entitlement protocol.

## Resulting state transitions

- `grandfatheredFreeAt != null`, revocation null, no active paid plan:
  Grandfathered Free.
- Canonical Partner API reports a configured paid handle: paid access and an
  atomic one-time revocation write.
- Paid plan later cancels, freezes, disappears, or becomes unknown:
  Payment required; revocation remains.
- An active contract with a missing or unknown handle is fail-closed as
  Payment required without changing a still-null revocation timestamp. A later
  verified legacy Basic state can resume an otherwise-valid grandfather.
- Paid access is accepted only while `billingSyncedAt` is within the configured
  60-minute maximum age. A transient Partner failure changes no grandfathering
  timestamp; stale paid access remains denied until a successful reconciliation.
- New install, legacy uninstall tombstone reinstall, missing plan, public Free
  selection during the cutover, or unknown handle: Payment required.
- Normal uninstall never clears grandfather or revocation timestamps and never
  clears merchant settings/data.
- Verified GDPR `shop/redact`: the Shop row and entitlement are deleted.
