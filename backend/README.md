# CallPilot production backend foundation

This folder defines the production data model and API contract for the portal.

## What is implemented in the repository
- Multi-tenant entities for businesses, users, customers and technicians
- Service-request lifecycle: new → contacted → scheduled → assigned → completed/cancelled
- Calls, protected recording references, transcripts and AI summaries
- Ava activity/audit events
- Notification and availability settings
- Integration connection records
- Won/lost outcomes and actual invoice values
- Confirmed-revenue view based only on won jobs
- Telephony/SMS/calendar webhook and API contracts

## What still requires external production services
The GitHub Pages site is static, so the API must be deployed to a server/runtime with PostgreSQL and authentication. Telephony/SMS requires a provider account and credentials; calendar access requires each business's authorization. Those credentials must never be committed to GitHub.

## Production checklist
1. Provision PostgreSQL and run schema.sql.
2. Deploy authenticated API implementation matching api-contract.js.
3. Configure server-side secrets and webhook signature validation.
4. Connect telephony/SMS provider.
5. Add OAuth for supported calendars.
6. Point portal.html at the deployed API base URL.
7. Test tenant isolation, retries, idempotency, emergency fallback and consent/privacy flows before a real pilot.
