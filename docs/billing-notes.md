# Billing notes

## This app now uses Managed Pricing
Do not use `appSubscriptionCreate` for the main Basic/Pro billing flow in this build.

Instead:
- configure pricing plans in the Shopify Partner Dashboard
- create one free public plan for **Basic**
- create one paid public plan for **Pro** at **£1/month**
- give each plan a stable `plan handle`
- route merchants to Shopify's hosted pricing page from inside the app

## Recommended managed pricing config

### Basic
- billing: Free
- display name: Basic
- handle: `basic`
- features:
  - EU withdrawal button
  - unlimited withdrawal requests
  - automatic confirmation emails
  - request dashboard
  - merchant notifications

### Pro
- billing: Monthly
- amount: £1
- display name: Pro
- handle: `pro`
- features:
  - everything in Basic
  - custom branding
  - custom email templates
  - adjustable withdrawal terms
  - DPA and GDPR settings
  - advanced exports and filtering

## In-app behavior
- `/billing/manage` returns Shopify's hosted pricing page URL
- `/billing/sync` and app boot query Partner API `activeSubscription`
- `/cron/reconcile-shopify-pricing` refreshes stale installed-shop billing
  state on a rate-limited schedule; stale paid state is denied server-side
- Partner API historical subscription events permanently revoke legacy Free
  after any paid activation, including an activation missed while the app was
  offline
- Shopify App Pricing redirect `plan_handle` is advisory only; Partner API
  current state remains authoritative
- Shopify App Pricing no longer relies on `app_subscriptions/update` or Admin
  API `appInstallation.activeSubscriptions`
- Pro access is determined from the active subscription's `planHandle`

## Important note
Downgrading from a paid plan to a free plan is handled by Shopify Managed Pricing and is not something your app should fake locally.
