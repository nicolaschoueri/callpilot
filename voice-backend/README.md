# CallPilot Voice Backend

This folder contains the real-phone backend for CallPilot. It is separate from the GitHub Pages sales/demo site, so changes here do not alter the existing browser demo.

## Intended call flow

1. Customer calls the business owner's existing public number.
2. If the owner answers, nothing changes.
3. If the owner does not answer, the owner's carrier conditionally forwards the call to a hidden CallPilot/SIP number.
4. The SIP provider routes that call to the OpenAI project SIP endpoint.
5. OpenAI fires the `live.transport.incoming` webhook.
6. This backend verifies the webhook, accepts the GPT-Live call, and attaches a sideband WebSocket.
7. Ava gathers the service problem, urgency, city, full address, callback phone, name, and preferred day/time.
8. The backend checks actual CallPilot availability.
9. Ava must obtain explicit confirmation of an exact slot.
10. Only then can the backend create the appointment.

## Current OpenAI architecture

New telephony implementation uses GPT-Live direct SIP:
- Voice frontend: `gpt-live-1`
- Backend delegation: `gpt-6-luna`
- Incoming webhook: `live.transport.incoming`
- Accept endpoint: `POST /v1/live/sessions/{session_id}/accept`
- Sideband: `wss://api.openai.com/v1/live/sessions/{session_id}/attach`
- Transfer: `POST /v1/live/sessions/{session_id}/refer`

The browser demo remains independent.

## Environment

Copy `.env.example` and set secrets only in the host's secret/environment-variable manager. Do not commit real secrets.

Required for real calls:
- `OPENAI_API_KEY`
- `OPENAI_WEBHOOK_SECRET`
- `OPENAI_PROJECT_ID`

Optional:
- `BUSINESS_NAME`
- `OWNER_FIRST_NAME`
- `BUSINESS_TIMEZONE`
- `OWNER_PHONE`
- `OWNER_TRANSFER_URI`
- `ADMIN_TOKEN`
- `CALLPILOT_DB_PATH`
- `DEMO_MODE`
- `PORT`

## External setup still required

Code alone cannot activate phone forwarding. For real calls:
1. Create the OpenAI project webhook and subscribe it to `live.transport.incoming`.
2. Configure the hidden SIP/telephony number to route to:
   `sip:YOUR_PROJECT_ID@sip.api.openai.com;transport=tls`
3. On the business owner's carrier, enable conditional call forwarding on no-answer to the hidden CallPilot number.
4. Connect the appointment store to the business's real calendar/CRM when moving beyond the built-in CallPilot appointment database.

## Local/demo verification

- `npm install`
- `npm run build`
- `npm test`
- `npm start`

Useful routes:
- `GET /`
- `GET /health`
- `GET /setup-status`
- `POST /api/test-booking` (demo mode only)
- `GET /api/appointments`
- `GET /api/leads`
- `POST /webhooks/openai`
