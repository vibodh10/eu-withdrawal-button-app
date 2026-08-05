# EU Withdrawal Button for Shopify

A hardened Shopify public app scaffold for an EU withdrawal button and withdrawal request workflow.

## Pricing model
- **Basic**: Free
- **Pro**: **£1/month**

## What changed in this hardening pass
- switched billing flow from mock `appSubscriptionCreate` scaffolding to **Shopify Managed Pricing** routing
- added managed pricing sync logic using `appInstallation.activeSubscriptions`
- added `planHandle` support so Basic and Pro can be mapped reliably
- added webhook signature verification for uninstall, GDPR, and `app_subscriptions/update`
- added session-token verification scaffolding for embedded admin requests
- preserved dev header auth as an explicit local-only fallback
- added billing sync endpoint and managed pricing UI actions
- expanded Prisma schema for subscription tracking fields

## Managed pricing setup
This build is designed for **Shopify Managed Pricing**, which is configured in the **Partner Dashboard**, not created by the Billing API.

Set up these two public plans in your Shopify App Store listing:

### Basic
- Free
- plan handle: `basic`
- feature copy should match your free tier

### Pro
- £1/month
- plan handle: `pro`
- include all higher-tier features in one offer
- set the welcome link to your app URL, for example:
  - `https://your-app-domain.example.com/?billing_return=1`

## Required environment variables
Copy `.env.example` to `.env` and update:
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_APP_HANDLE`
- `SHOPIFY_MANAGED_PRICING_BASIC_HANDLE`
- `SHOPIFY_MANAGED_PRICING_PRO_HANDLE`
- `DATABASE_URL`
- SMTP values if you want real email sending

## How the managed pricing flow works
1. Merchant opens your embedded app.
2. Merchant clicks the plan button in the Plans screen.
3. The app redirects them to Shopify’s hosted pricing page.
4. Shopify handles charge approval.
5. Shopify returns the merchant to your configured welcome link.
6. The app calls `/billing/sync` and updates local plan access.
7. `app_subscriptions/update` webhook keeps the database aligned when changes happen later.

## Dev notes
For local testing, this scaffold still allows `x-shop-domain` auth when `ALLOW_DEV_HEADER_AUTH=true`.
That is only a development fallback. For review and production, your frontend should send real Shopify session tokens on authenticated embedded requests.

## Commands
```bash
npm install
npm --prefix web install
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

## Still not fully production-complete
This is now meaningfully closer to submission quality, but there are still some final items you should complete before claiming it is fully App Store-ready:
- wire your real Shopify OAuth install flow so `accessToken` is stored properly
- connect App Bridge authenticated requests in the admin frontend instead of the dev header fallback
- run a real Partner Dashboard managed pricing test on a dev store
- verify the exact GraphQL shape returned by your store for `planHandle`
- complete end-to-end QA for install, upgrade, downgrade, uninstall, and webhook replay cases

## Security documentation

See [Data Loss Prevention Strategy](docs/security/data-loss-prevention.md).