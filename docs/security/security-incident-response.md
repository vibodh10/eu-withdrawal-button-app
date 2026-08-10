# Security Incident Response Policy

**Application:** EU Withdrawal Button  
**Owner:** Growth Labs 6  
**Effective date:** 10 August 2026  
**Review frequency:** Annually and after every security incident or material security change

## 1. Purpose

This policy defines how Growth Labs 6 identifies, contains, investigates,
responds to, documents, and recovers from security incidents affecting the
EU Withdrawal Button application.

The objective is to limit harm to merchants and customers, protect Shopify
merchant data, preserve evidence, restore secure operation, and meet
notification obligations.

## 2. Scope

This policy applies to incidents involving:

- Shopify merchant or customer data
- Application databases
- Shopify access or refresh tokens
- API credentials and application secrets
- Email-delivery systems
- Application hosting and infrastructure
- Source-code repositories
- Administrative accounts
- Production and development environments
- Unauthorised use of application functionality

Relevant systems include Shopify, Railway, Neon, GitHub, Resend and associated
Google accounts.

## 3. Security incident severity

### Severity 1 — Critical

Examples:

- Confirmed unauthorised disclosure of merchant or customer data
- Compromise of production credentials or Shopify access tokens
- Active exploitation of the application
- Large-scale unauthorised email or data transmission
- Confirmed access to production data by an unauthorised party

Required response:

- Begin containment immediately
- Disable affected functionality where necessary
- Revoke compromised credentials
- Preserve evidence
- Notify Shopify where Merchant Data might be affected
- Investigate scope and impact
- Do not restore affected functionality until the vulnerability is corrected

### Severity 2 — High

Examples:

- Suspected unauthorised access
- A serious vulnerability capable of exposing protected customer data
- Abnormal access or transmission activity with no confirmed disclosure
- Compromise of an account controlling production systems

Required response:

- Investigate immediately
- Restrict or disable affected access
- Rotate or revoke potentially compromised credentials
- Preserve relevant logs
- Escalate to Severity 1 if data exposure is confirmed or reasonably suspected

### Severity 3 — Medium

Examples:

- Failed repeated authentication attempts
- Blocked attempts to exploit an endpoint
- Security configuration errors without confirmed data access
- Unexpected but contained application behaviour

Required response:

- Investigate
- Correct the underlying issue
- Review relevant logs
- Document material findings

### Severity 4 — Low

Examples:

- Minor security warnings
- Non-exploitable configuration findings
- Security improvements identified through routine review

Required response:

- Record and correct during normal maintenance
- Escalate if investigation identifies greater risk

## 4. Roles and responsibilities

Growth Labs 6 is responsible for incident response for the EU Withdrawal
Button application.

The application owner is the Incident Lead and is responsible for:

- Assessing severity
- Initiating containment
- Revoking or rotating credentials
- Preserving evidence
- Coordinating investigation
- Contacting Shopify and relevant service providers
- Determining when affected services may be restored
- Recording corrective actions
- Reviewing this policy after the incident

Service providers such as Shopify, Railway, Neon, GitHub and Resend may be
contacted when their systems, records, or credentials are relevant to an
incident.

## 5. Detection

Potential incidents may be identified through:

- Application logs
- DataAccessAudit records
- Railway logs
- Neon database activity
- Email-provider activity
- Shopify notifications
- GitHub security notifications
- Account-security notifications
- Merchant or customer reports
- Unexpected request or email volume
- Failed authentication or app-proxy verification
- Rate-limit or blocked-shop events

Any indication of unauthorised data access, disclosure, credential compromise,
or abuse must be investigated.

## 6. Immediate containment

When an active or suspected serious incident is identified, the Incident Lead
must take appropriate containment measures.

Depending on the incident, these may include:

- Disable affected application functionality
- Enable an application-wide kill switch
- Block a malicious merchant or shop
- Revoke compromised API keys
- Revoke or rotate Shopify credentials
- Revoke email-provider credentials
- Disable automated email delivery
- Restrict database access
- Terminate unauthorised sessions
- Suspend affected integrations

Availability may be temporarily reduced when necessary to protect merchant or
customer data.

## 7. Credential compromise

A known or suspected compromised credential must not continue to be used.

Where appropriate:

1. Revoke the affected credential.
2. Generate a replacement credential.
3. Update the authorised production environment.
4. Verify that the old credential no longer works.
5. Review logs for unauthorised use.
6. Record the rotation or revocation as part of the incident record.

For a serious compromise of Shopify client credentials, compromised
credentials must be revoked promptly before secure replacement and recovery.

## 8. Evidence preservation

Relevant evidence must be preserved before unnecessary changes are made to
affected systems where practical.

Evidence may include:

- Railway application logs
- Neon database snapshots or branches
- Email-provider records
- Shopify records
- GitHub commit history
- Request identifiers and timestamps
- Relevant screenshots
- Exported service records
- Incident timelines

Evidence files must:

- Be stored outside the public application repository
- Be access restricted
- Be encrypted where they contain sensitive data
- Have integrity hashes recorded where appropriate
- Not be modified after preservation
- Have working copies separated from preserved originals where practical

Customer data must not be unnecessarily included in evidence.

## 9. Investigation

The investigation should determine, where possible:

- How the incident occurred
- When it started and ended
- Systems and accounts affected
- Merchants affected
- Customer records affected
- Data accessed, disclosed, modified or transmitted
- Credentials involved
- Whether the vulnerability remains exploitable
- Whether the incident remains active

Conclusions should be based on preserved evidence rather than assumptions.

## 10. Shopify notification

Any actual or suspected breach or compromise of Shopify Merchant Data must be
reported to Shopify immediately upon becoming aware of it and no later than
24 hours after awareness.

The report should be made through the appropriate Shopify Support channel.

Growth Labs 6 will:

- Provide known facts available at the time
- Continue investigating after the initial notification
- Provide Shopify with reasonable progress updates
- Respond to requests for additional information
- Cooperate with Shopify's investigation

Notification must not be unnecessarily delayed while every detail of an
incident is still being established.

## 11. Other notifications

Where appropriate, Growth Labs 6 will also determine whether notification is
required to:

- Affected merchants
- Customers
- Relevant service providers
- Data-protection or other regulatory authorities
- Law-enforcement authorities

Notification decisions will take account of applicable legal and contractual
requirements and the nature of the affected information.

## 12. Eradication and corrective action

Before restoring affected functionality:

- The root cause or exploitable weakness must be identified where possible
- The vulnerability must be corrected
- Compromised credentials must be revoked or rotated
- Malicious access must be removed or blocked
- Relevant security controls must be reviewed
- Changes must be tested

Examples of corrective controls include:

- Stronger authentication
- App-proxy validation
- Recipient verification
- Rate limiting
- Idempotency controls
- Removal of arbitrary recipient or HTML inputs
- Improved access logging
- Data minimisation
- Environment separation

## 13. Recovery

Affected services may be restored after the Incident Lead determines that:

- The immediate threat has been contained
- The known vulnerability has been corrected
- Required credentials have been replaced
- Security tests have passed
- Monitoring is in place for recurrence

High-risk functionality may remain disabled until additional safeguards or
third-party approvals are complete.

## 14. Post-incident review

After a material incident, Growth Labs 6 will document:

- Incident summary
- Timeline
- Root cause
- Data and systems affected
- Containment actions
- Notifications made
- Corrective actions
- Remaining follow-up actions

The application architecture, DLP strategy, access controls and this incident
response policy will be reviewed following a significant incident.

## 15. Evidence and records

Incident records are maintained privately and are not stored in the public
GitHub repository.

Records may include:

- Incident timeline
- Preserved logs
- Screenshots
- Service-provider reports
- Evidence hashes
- Security-change commits
- Notification records
- Corrective-action notes

Sensitive evidence is encrypted or otherwise access restricted.

## 16. Testing and review

This policy is reviewed:

- At least annually
- Following every material security incident
- Following a significant infrastructure or authentication change
- Before requesting materially broader access to protected customer data

Incident-response controls may also be tested using non-production or
synthetic data.