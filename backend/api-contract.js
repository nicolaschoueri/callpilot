// CallPilot backend contract.
// Deploy behind authentication. Every query/action MUST be scoped to the authenticated business_id.
// Provider secrets belong in server-side environment variables only.

export const REQUEST_STATUSES = ['new','contacted','scheduled','assigned','completed','cancelled'];
export const OUTCOMES = ['unconfirmed','won','lost'];

export const routes = {
  dashboard: 'GET /api/dashboard',
  requests: 'GET /api/requests',
  request: 'GET /api/requests/:id',
  updateRequest: 'PATCH /api/requests/:id',
  customerHistory: 'GET /api/customers/:id/history',
  technicians: 'GET /api/technicians',
  activity: 'GET /api/requests/:id/activity',
  outcome: 'PATCH /api/requests/:id/outcome',
  notificationSettings: 'GET|PUT /api/settings/notifications',
  availabilitySettings: 'GET|PUT /api/settings/availability',
  integrations: 'GET /api/integrations',
  inboundCallWebhook: 'POST /api/webhooks/telephony/inbound',
  callStatusWebhook: 'POST /api/webhooks/telephony/status',
  recordingWebhook: 'POST /api/webhooks/telephony/recording',
  smsWebhook: 'POST /api/webhooks/telephony/sms',
  calendarAvailability: 'GET /api/calendar/availability',
  calendarBook: 'POST /api/calendar/book',
  calendarReschedule: 'POST /api/calendar/reschedule',
  calendarCancel: 'POST /api/calendar/cancel'
};

// Required behavior:
// - Verify provider webhook signatures.
// - Idempotently process provider_call_id/event IDs.
// - Never let the AI promise an appointment unless calendar/provider confirmation succeeds.
// - Emergency transfer failure returns to capture flow; never drop the caller.
// - Record/transcribe only under configured consent/privacy policy.
// - Store recording URLs as protected provider references, not public assets.
// - "Confirmed revenue" = sum(invoice_amount) only where outcome='won'.
// - Log call answered, qualified, emergency identified, transfer attempted/succeeded/failed,
//   owner notification, customer confirmation, booking/reschedule/cancel and outcome changes.
// - Calendar is optional: without it, capture preferred_at and set status to contacted/new.
// - Use deterministic business rules for emergency classification and booking boundaries.
