# CallPilot

CallPilot is a bilingual AI receptionist platform for service businesses. Ava answers eligible missed/after-hours calls, qualifies the customer, checks service rules, captures leads, supports urgent escalation and can book appointments when a calendar is enabled.

## Demo links

- Main sales demo: https://nicolaschoueri.github.io/callpilot/
- Full business platform demo: https://nicolaschoueri.github.io/callpilot/platform-demo.html
- Owner portal demo: https://nicolaschoueri.github.io/callpilot/portal.html
- Missed-call demo: https://nicolaschoueri.github.io/callpilot/missed-call-demo.html

## Product architecture

### Customer-facing call flow

```text
Customer calls contractor's existing number
          |
          | contractor answers -> normal call, CallPilot does nothing
          |
          + no answer / after hours / busy
          |
          v
Hidden CallPilot number assigned to that business
          |
          v
Twilio secure Elastic SIP Trunk
          |
          v
OpenAI GPT-Live
          |
          v
CallPilot voice backend sideband
          |
          + service-area rules
          + lead capture
          + emergency escalation
          + optional owner transfer
          + optional owner SMS
          + lead-only or live booking
```

The customer keeps using the business number they already know. The hidden CallPilot number is only a routing destination and business identifier.

## Repository map

- `index.html` / `friendly.html` — public sales demo and Ava simulator
- `platform-demo.html` — full platform/admin demo
- `portal.html` — compact contractor owner portal demo
- `missed-call-demo.html` — focused missed-call experience
- `audio/` and `assets/` — demo media
- `voice-backend/` — production-oriented GPT-Live/SIP backend
- `.github/workflows/test-voice-backend.yml` — backend build and tests

## Voice backend

See [voice-backend/README.md](voice-backend/README.md) for:

- multi-business routing
- GPT-Live direct SIP
- Twilio secure trunk setup
- optional calendar modes
- owner notifications
- admin/onboarding APIs
- Docker deployment
- activation requirements

## Production boundary

The software can be built and tested in this repository, but live public phone calls require infrastructure owned by the operator:

- OpenAI API/project credentials and webhook secret
- Twilio account and voice-capable routing number(s)
- secure Twilio Elastic SIP Trunk
- contractor carrier access to enable conditional call forwarding
- a public host for the voice backend

Real secrets must never be committed to GitHub.
