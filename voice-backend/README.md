# CallPilot Voice Backend

This folder is the production-oriented phone backend for CallPilot. It is intentionally separate from the GitHub Pages sales/demo site so the public demo can stay stable while the real-call service is deployed independently.

## What is implemented

- Real inbound GPT-Live call acceptance through OpenAI SIP
- One CallPilot routing profile per paying business
- One hidden forwarding number per business
- English / Canadian French Ava flow
- Trade-aware prompts for HVAC, plumbing, electrical, roofing and general service
- Service-area validation
- Caller contact and lead capture
- Regular versus emergency triage
- Optional owner transfer through SIP REFER
- Optional owner SMS notification through Twilio
- Calendar-optional behavior
- Internal CallPilot appointment scheduling when enabled
- Explicit caller confirmation before any appointment is written
- Business-isolated calls, leads, appointments and availability
- Tool-call and webhook idempotency
- Admin APIs for onboarding and managing business profiles
- Docker packaging and GitHub Actions tests

## End-to-end call flow

1. The customer calls the contractor's existing public business number.
2. If the contractor answers, CallPilot is never involved.
3. The contractor's carrier conditionally forwards unanswered, after-hours or busy calls to that contractor's hidden CallPilot number.
4. The hidden number is a Twilio number attached to the CallPilot Elastic SIP Trunk.
5. Twilio sends the SIP call securely to the OpenAI project SIP endpoint.
6. Twilio preserves the hidden number that was dialed in the SIP Diversion header.
7. OpenAI emits a `live.transport.incoming` webhook.
8. This backend verifies the webhook, resolves the business by that hidden number, and accepts the GPT-Live session.
9. The backend attaches a private sideband WebSocket for service-area checks, lead saving, availability, booking, notifications and transfer.
10. Ava talks to the caller using the resolved business's name, trade, service area, language and calendar rules.
11. The lead and outcome are stored under the correct business.

## Why each business gets a hidden number

The customer does **not** need a new number. They keep calling the business number they already know.

The hidden CallPilot number exists only as the forwarding destination. It gives CallPilot a reliable routing key so one shared backend can identify which contractor Ava is representing.

Example:

```text
Customer
  -> (514) 555-0100  contractor's existing public number
  -> no answer
  -> +1 438 555 0142 hidden CallPilot number for Business A
  -> Twilio SIP trunk
  -> OpenAI GPT-Live
  -> CallPilot resolves Business A
  -> Ava answers as Business A
```

A second paying contractor receives a different hidden CallPilot number but uses the same trunk, OpenAI project and backend.

## Calendar modes

Each business has one of two calendar modes.

### `lead_only`

Use this when the contractor has no connected calendar.

Ava:
- gathers the preferred day/time
- saves the lead
- notifies the owner when notifications are configured
- tells the caller the business will confirm

Ava cannot claim an appointment was booked in this mode.

### `internal`

Use the built-in CallPilot scheduler.

Ava:
- checks actual available CallPilot slots
- offers only returned slots
- obtains explicit confirmation of one exact slot
- books only after confirmation
- notifies the owner when configured

The storage adapter can later be replaced by a Google/Microsoft/CRM calendar adapter without changing the phone-routing design.

## OpenAI architecture

- Voice frontend: `gpt-live-1`
- Backend delegation: `gpt-6-luna`
- Incoming webhook: `live.transport.incoming`
- Accept: `POST /v1/live/sessions/{session_id}/accept`
- Sideband: `wss://api.openai.com/v1/live/sessions/{session_id}/attach`
- Transfer: `POST /v1/live/sessions/{session_id}/refer`

The sideband connection keeps booking and business logic private from the caller and allows the backend to execute tools while Ava continues the live conversation.

## Twilio SIP setup

Use one Elastic SIP Trunk for CallPilot.

1. Enable Secure Trunking so signaling uses TLS and media uses SRTP.
2. Configure the Origination SIP URI as:

```text
sip:YOUR_OPENAI_PROJECT_ID@sip.api.openai.com;transport=tls
```

3. Attach each hidden CallPilot Twilio number to that trunk.
4. Store each hidden number in the matching business profile as `callpilotNumber`.

Twilio places the originally dialed Twilio number in the SIP `Diversion` header on trunk-origination calls. CallPilot uses that number to select the business profile. SIP headers are routing metadata, not authentication.

## OpenAI project setup

Create an OpenAI project webhook that points to:

```text
https://YOUR_VOICE_BACKEND_HOST/webhooks/openai
```

Subscribe it to:

```text
live.transport.incoming
```

Store the webhook signing secret in `OPENAI_WEBHOOK_SECRET`.

## Business carrier setup

On the contractor's existing phone service, configure whichever rules the contractor wants:

- forward on no answer
- forward after hours
- forward when busy

The forwarding destination is that business's hidden CallPilot Twilio number.

This step is carrier-side configuration. CallPilot code cannot activate forwarding on a phone line that it does not control.

## Environment

Copy `.env.example`. Never commit real credentials.

Required for real GPT-Live calls:

- `OPENAI_API_KEY`
- `OPENAI_WEBHOOK_SECRET`
- `OPENAI_PROJECT_ID`

Default business seed:

- `DEFAULT_BUSINESS_ID`
- `BUSINESS_NAME`
- `OWNER_FIRST_NAME`
- `BUSINESS_TRADE`
- `BUSINESS_TIMEZONE`
- `CALLPILOT_NUMBER`
- `OWNER_PHONE`
- `OWNER_TRANSFER_URI`
- `SERVICE_AREAS`
- `CALENDAR_MODE`

Optional owner SMS:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_SMS_FROM`
- `TWILIO_MESSAGING_SERVICE_SID`

Backend:

- `ADMIN_TOKEN`
- `CALLPILOT_DB_PATH`
- `ALLOW_SINGLE_BUSINESS_FALLBACK`
- `DEMO_MODE`
- `PORT`

For production, set `DEMO_MODE=false`, set a strong `ADMIN_TOKEN`, and disable `ALLOW_SINGLE_BUSINESS_FALLBACK`.

## Business onboarding API

Admin routes require:

```text
Authorization: Bearer YOUR_ADMIN_TOKEN
```

Main routes:

- `GET /api/businesses`
- `POST /api/businesses`
- `GET /api/businesses/:id`
- `PATCH /api/businesses/:id`
- `GET /api/businesses/:id/calls`
- `GET /api/businesses/:id/leads`
- `GET /api/businesses/:id/appointments`
- `GET /api/businesses/:id/availability`

Example business payload:

```json
{
  "id": "west-island-hvac",
  "name": "West Island HVAC",
  "ownerFirstName": "John",
  "trade": "hvac",
  "timezone": "America/Toronto",
  "callpilotNumber": "+14385550142",
  "ownerPhone": "+15145550100",
  "serviceAreas": ["Kirkland", "Pointe-Claire", "Beaconsfield"],
  "calendarMode": "lead_only",
  "active": true
}
```

## Local verification

```text
npm install
npm run check
npm run dev
```

Useful public routes:

- `GET /`
- `GET /health`
- `GET /setup-status`
- `POST /webhooks/openai`

Demo-only:

- `POST /api/test-booking`

## Docker

Build from the `voice-backend` directory and run it on a host that supports:

- persistent outbound WebSocket connections
- public HTTPS webhooks
- persistent storage for `/data/callpilot.db`

The included Dockerfile runs build/tests during image construction and exposes port 3000.

## What still requires external credentials

The code can be complete without these accounts, but a real customer cannot call Ava until the owner of the infrastructure supplies:

1. OpenAI API/project credentials and webhook signing secret
2. A Twilio account with at least one voice-capable hidden number
3. A configured secure Elastic SIP Trunk
4. Access to the contractor's carrier settings for conditional call forwarding

No secret values belong in this repository.
