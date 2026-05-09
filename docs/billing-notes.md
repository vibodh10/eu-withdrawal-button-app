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
- `/billing/sync` checks `appInstallation.activeSubscriptions`
- `app_subscriptions/update` webhook updates local access state
- Pro access is determined from the active subscription's `planHandle`

## Important note
Downgrading from a paid plan to a free plan is handled by Shopify Managed Pricing and is not something your app should fake locally.
