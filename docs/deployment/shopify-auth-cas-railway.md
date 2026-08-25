# Railway Shopify authentication CAS cutover

This migration must use a maintenance/drain cutover. Do not release it with
Railway's normal rolling deployment: the previous application image can write
Shopify authentication fields without incrementing `authVersion`.

The cutover is intentionally a single application release with a short outage.
It does not require a bridge release or a temporary database trigger.

## Before the cutover

1. Build and test the exact release commit, but disable automatic production
   deployment until the cutover window.
2. Take a PostgreSQL backup or confirm the latest Railway backup is usable.
3. Make an explicit inventory of every web, worker, and cron service that can
   touch Shopify authentication state. Record each service's replica count in
   every region and the exact CAS release commit/image that all services will
   run after the cutover.
4. Pause the external caller for `/cron/refresh-shopify-tokens` and any Railway
   scheduled job or worker that can run the same code.

## Cutover order

1. Scale every web, worker, and cron service using this database to zero in all
   regions. For example:

       railway scale --service <service> --environment production <region>=0

2. Wait for Railway to finish gracefully draining every old replica. Confirm
   that no application deployment or scheduled execution remains active. This
   is the ordering barrier: do not continue while an old process can write.
3. From the exact release commit, apply the additive migration against the
   production database:

       railway run --service <service> --environment production npx prisma migrate deploy

4. Deploy the exact same tested CAS-aware release to **every** drained web,
   worker, and cron service while all services remain at zero replicas. Repeat
   this command for each service in the inventory and confirm every image built
   successfully:

       railway up --service <auth-service> --environment production --ci

5. Before scaling up any service, verify that every inventoried service's
   selected/latest deployment has the exact recorded CAS release commit or
   image digest. Cancel or remove every queued, staged, or automatic deployment
   that references an older commit/image. If any service is unverified or any
   old deployment can still become active, keep all services at zero.
6. Only after the all-services release check passes, restore every service's
   recorded replica counts. For example:

       railway scale --service <auth-service> --environment production <region>=1

7. Wait for `/health` to return HTTP 200, then verify a managed-install request,
   an authenticated admin request, and the uninstall webhook route in logs.
   Confirm again that each running web/worker/cron replica reports the recorded
   CAS release commit/image; do not restore an old image to increase capacity.
8. Resume the external token-refresh schedule and run it once manually. A shop
   already marked `REFRESHING` represents an ambiguous, interrupted at-most-once
   attempt and must be recovered through a current merchant ID-token exchange;
   do not clear the claim and retry its old refresh token.

## Rollback boundary

Before step 6, the migration is additive, so the previous image can be restored
while all services are still at zero. Do not run the previous image after
traffic is restored: it does not participate in `authVersion`. If rollback is
needed after step 5, drain to zero again before changing application versions.

Shopify retries webhook deliveries, so the brief drained interval should not be
filled by an old replica. The verified uninstall handler remains authoritative:
it clears credentials and refresh ownership while incrementing `authVersion`.
Merchant settings and application data remain on the existing `Shop` row.
