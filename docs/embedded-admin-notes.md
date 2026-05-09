# Embedded admin notes

## Session token requirement
This build includes backend verification scaffolding for Shopify session tokens.

Production expectation:
- the embedded admin frontend obtains a fresh session token from Shopify App Bridge
- the frontend sends it in the `Authorization: Bearer <token>` header
- the backend verifies the JWT using `SHOPIFY_API_SECRET`

## Local development fallback
For faster local development this scaffold also supports:
- `x-shop-domain` header auth
- enabled only when `ALLOW_DEV_HEADER_AUTH=true`

Do not rely on that fallback for production review.

## What still needs wiring on the frontend
To pass final review more confidently, the React admin should be connected to Shopify App Bridge authenticated fetch instead of the local dev header helper.
