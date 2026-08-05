# Data Loss Prevention Strategy

**Application:** EU Withdrawal Button  
**Owner:** Growth Labs 6  
**Effective date:** 5 August 2026  
**Review frequency:** Annually and after any security incident or major system change

## 1. Purpose

This document describes the controls used to prevent unauthorised access,
disclosure, copying, export, transmission, alteration, or loss of merchant
and customer data processed by the EU Withdrawal Button application.

## 2. Data covered

The application may process:

- Shopify shop identifiers
- Order identifiers and order numbers
- Customer names
- Customer email addresses
- Withdrawal request information
- Request status and timestamps
- Shopify access and refresh tokens
- Email-delivery credentials

The application does not intentionally collect payment-card details,
customer passwords, identity documents, or banking information.

## 3. Data minimisation

Only data required to receive, verify, manage, and document withdrawal
requests is collected.

The application does not store complete Shopify API responses or complete
incoming request bodies.

Sensitive values are not included in application logs.

## 4. Production and development separation

Production data is stored in the production Neon database used by the
Railway production environment.

Development and testing use a separate Neon database.

Production customer records are not copied into development. Development
uses synthetic information or data created through a Shopify development
store.

Production database credentials are stored only in the production hosting
environment.

## 5. Authentication and access control

Administrative routes require a valid Shopify session token.

The shop identity is obtained from the verified token and is not trusted
from a query parameter or request body.

Blocked, unknown, or uninstalled shops are denied access.

Accounts controlling Shopify, Railway, Neon, GitHub, Resend, and associated
email services use strong authentication and two-factor authentication
where supported.

Shared administrator accounts are not permitted.

## 6. Personal-data access auditing

Personal-data access is recorded in the `DataAccessAudit` database table.

Audit entries contain identifiers and event information but do not contain
customer names, customer email addresses, withdrawal reasons, credentials,
or access tokens.

Recorded events include:

- `WITHDRAWAL_LIST_VIEWED`
- `WITHDRAWAL_EXPORTED`
- `WITHDRAWAL_UPDATED`
- `WITHDRAWAL_DELETED`
- `CUSTOMER_DATA_DELETED`
- `CUSTOMER_DATA_REQUESTED`
- `CUSTOMER_DATA_REDACTED`
- `RETENTION_CLEANUP`

Audit records include:

- Shop identifier where applicable
- Action
- Internal record identifier where applicable
- Number of records affected
- Actor type
- Reason
- Timestamp

## 7. Logging controls

The following must not be written to application logs:

- Customer names
- Customer email addresses
- Withdrawal reasons
- Shopify access tokens
- Shopify refresh tokens
- Session tokens
- SMTP passwords
- Database credentials
- Complete request bodies
- Complete database records

Logs may include internal identifiers, event names, status values, timestamps,
and non-sensitive error messages.

## 8. Data exports

Production data is not exported routinely.

CSV exports are available only to authenticated merchants with the required
subscription plan.

Every export is recorded in the data-access audit log.

CSV responses use no-store cache headers and exported values are protected
against spreadsheet formula injection.

Exported files must not be uploaded to public repositories, public links,
chat systems, or unsecured storage.

Temporary exports must be deleted when no longer required.

## 9. Tenant separation

All database reads, updates, and deletions involving merchant or customer
data are restricted using the authenticated shop identifier.

A merchant cannot access or delete records belonging to another merchant.

Shopify privacy webhook operations are also restricted to the shop that sent
the verified webhook.

## 10. Data transmission

Customer and merchant data is transmitted only over HTTPS/TLS connections.

Public users cannot select arbitrary email recipients, sender identities,
HTML templates, links, or branding for automatic messages.

Customer confirmation messages may only be sent to an address retrieved from
and matched against the corresponding Shopify order.

Automatic email delivery remains disabled until the required Shopify
protected-customer-data access and verification controls are available.

## 11. Secrets management

Secrets are stored as protected environment variables and are not committed
to source control.

The following are treated as secrets:

- Database URLs
- Shopify API secrets
- Shopify access and refresh tokens
- Resend API keys
- SMTP passwords
- Encryption keys
- Cron authentication secrets

The cron endpoints reject requests when `CRON_SECRET` is missing, when the
request header is missing, or when the supplied secret does not match.

## 12. Retention and deletion

Approved and rejected withdrawal requests are automatically deleted 60 days
after their resolution date.

The cleanup process is authenticated using the cron secret and records a
`RETENTION_CLEANUP` audit event.

Customer information may also be deleted following an authenticated merchant
request or a verified Shopify privacy webhook.

## 13. Incident response

When unauthorised access, disclosure, or transmission is suspected:

1. Disable the affected function.
2. Revoke affected credentials.
3. Preserve relevant logs and evidence securely.
4. Block malicious or compromised access.
5. Determine the affected records and time period.
6. Notify relevant providers or authorities where required.
7. Correct and test the vulnerability before restoring the function.
8. Document the incident and resulting improvements.

Incident evidence must not be committed to this repository.

## 14. Review

This strategy is reviewed:

- At least annually
- After a security incident
- After a material infrastructure change
- Before requesting additional Shopify protected-customer-data access