import "dotenv/config";
import express from "express";
import {
  CallPilotStore,
  type BusinessInput,
  type CalendarMode,
  type Trade
} from "./store.js";
import { CallPilotLive } from "./live.js";
import { OwnerNotifier } from "./notifications.js";

const PORT = Number(process.env.PORT || 3000);
const DEMO_MODE =
  String(process.env.DEMO_MODE ?? "true").toLowerCase() === "true";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_WEBHOOK_SECRET = process.env.OPENAI_WEBHOOK_SECRET || "";
const OPENAI_PROJECT_ID = process.env.OPENAI_PROJECT_ID || "";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

const DEFAULT_BUSINESS_ID =
  process.env.DEFAULT_BUSINESS_ID || "west-island-home-services";
const BUSINESS_NAME =
  process.env.BUSINESS_NAME || "West Island Home Services";
const OWNER_FIRST_NAME = process.env.OWNER_FIRST_NAME || "John";
const BUSINESS_TIMEZONE =
  process.env.BUSINESS_TIMEZONE || "America/Toronto";
const BUSINESS_TRADE = parseTrade(process.env.BUSINESS_TRADE);
const CALLPILOT_NUMBER =
  process.env.CALLPILOT_NUMBER || "+14385550142";
const OWNER_PHONE = process.env.OWNER_PHONE || "";
const OWNER_TRANSFER_URI = process.env.OWNER_TRANSFER_URI || "";
const SERVICE_AREAS = String(process.env.SERVICE_AREAS || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);
const CALENDAR_MODE = parseCalendarMode(process.env.CALENDAR_MODE);

function parseTrade(value: unknown): Trade {
  const v = String(value || "").toLowerCase();
  return ["hvac", "plumbing", "electrical", "roofing", "general"].includes(v)
    ? (v as Trade)
    : "hvac";
}

function parseCalendarMode(value: unknown): CalendarMode {
  return String(value || "").toLowerCase() === "internal"
    ? "internal"
    : "lead_only";
}

function boolValue(value: unknown, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["true", "1", "yes", "on"].includes(String(value).toLowerCase());
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const store = new CallPilotStore(
  process.env.CALLPILOT_DB_PATH,
  BUSINESS_TIMEZONE
);

store.createBusinessIfMissing({
  id: DEFAULT_BUSINESS_ID,
  name: BUSINESS_NAME,
  ownerFirstName: OWNER_FIRST_NAME,
  trade: BUSINESS_TRADE,
  timezone: BUSINESS_TIMEZONE,
  callpilotNumber: CALLPILOT_NUMBER,
  ownerPhone: OWNER_PHONE || undefined,
  ownerTransferUri: OWNER_TRANSFER_URI || undefined,
  serviceAreas: SERVICE_AREAS,
  calendarMode: CALENDAR_MODE,
  active: true
});

const notifier = new OwnerNotifier({
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN,
  fromNumber: process.env.TWILIO_SMS_FROM,
  messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID
});

const live =
  OPENAI_API_KEY && OPENAI_WEBHOOK_SECRET
    ? new CallPilotLive({
        apiKey: OPENAI_API_KEY,
        webhookSecret: OPENAI_WEBHOOK_SECRET,
        store,
        notifier,
        defaultBusinessId: DEFAULT_BUSINESS_ID,
        allowSingleBusinessFallback:
          DEMO_MODE &&
          String(process.env.ALLOW_SINGLE_BUSINESS_FALLBACK ?? "true")
            .toLowerCase() === "true"
      })
    : null;

function setupStatus() {
  const required: Array<[string, string]> = [
    ["OPENAI_API_KEY", OPENAI_API_KEY],
    ["OPENAI_WEBHOOK_SECRET", OPENAI_WEBHOOK_SECRET],
    ["OPENAI_PROJECT_ID", OPENAI_PROJECT_ID]
  ];
  const missing = required
    .filter(([, value]) => !value)
    .map(([key]) => key);

  const businesses = store.listBusinesses();
  return {
    backend_running: true,
    demo_mode: DEMO_MODE,
    ready_for_real_calls: missing.length === 0 && businesses.length > 0,
    default_business_id: DEFAULT_BUSINESS_ID,
    business_count: businesses.length,
    routing_numbers: businesses.map((b) => ({
      business_id: b.id,
      business_name: b.name,
      callpilot_number: b.callpilotNumber,
      calendar_mode: b.calendarMode,
      active: b.active
    })),
    owner_sms_configured: notifier.isConfigured(),
    missing,
    external_setup_still_required: [
      "OpenAI project webhook subscribed to live.transport.incoming",
      "Twilio Elastic SIP Trunk with Secure Trunking enabled",
      "Twilio trunk Origination URI pointed at the OpenAI SIP project endpoint",
      "One hidden Twilio routing number per paying business attached to the trunk",
      "Each business carrier configured for conditional no-answer/after-hours forwarding to its hidden CallPilot number"
    ],
    sip_target: OPENAI_PROJECT_ID
      ? `sip:${OPENAI_PROJECT_ID}@sip.api.openai.com;transport=tls`
      : null
  };
}

function routeId(req: express.Request): string {
  const value: string | string[] = req.params.id;
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

function adminAllowed(req: express.Request) {
  if (!ADMIN_TOKEN) return DEMO_MODE;
  return req.headers.authorization === `Bearer ${ADMIN_TOKEN}`;
}

function requireAdmin(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  if (!adminAllowed(req)) {
    res.sendStatus(403);
    return;
  }
  next();
}

function businessFromBody(
  body: any,
  existing?: ReturnType<CallPilotStore["getBusiness"]>
): BusinessInput {
  return {
    id: String(body?.id ?? existing?.id ?? "").trim(),
    name: String(body?.name ?? existing?.name ?? "").trim(),
    ownerFirstName: String(
      body?.ownerFirstName ?? existing?.ownerFirstName ?? "Owner"
    ).trim(),
    trade: parseTrade(body?.trade ?? existing?.trade),
    timezone: String(
      body?.timezone ?? existing?.timezone ?? BUSINESS_TIMEZONE
    ).trim(),
    callpilotNumber: String(
      body?.callpilotNumber ?? existing?.callpilotNumber ?? ""
    ).trim(),
    ownerPhone: String(
      body?.ownerPhone ?? existing?.ownerPhone ?? ""
    ).trim() || undefined,
    ownerTransferUri:
      String(
        body?.ownerTransferUri ?? existing?.ownerTransferUri ?? ""
      ).trim() || undefined,
    serviceAreas: Array.isArray(body?.serviceAreas)
      ? body.serviceAreas.map((v: unknown) => String(v).trim()).filter(Boolean)
      : existing?.serviceAreas ?? [],
    calendarMode: parseCalendarMode(
      body?.calendarMode ?? existing?.calendarMode
    ),
    active: boolValue(body?.active, existing?.active ?? true)
  };
}

const app = express();

app.post(
  "/webhooks/openai",
  express.text({ type: "application/json" }),
  async (req, res) => {
    if (!live) {
      res.status(503).send("OpenAI telephony configuration missing");
      return;
    }

    let event: any;
    try {
      event = await live.verifyWebhook(req.body, req.headers);
    } catch {
      res.status(400).send("Invalid webhook signature");
      return;
    }

    if (event.type !== "live.transport.incoming") {
      res.sendStatus(200);
      return;
    }

    if (!store.recordWebhook(String(event.id || ""))) {
      res.sendStatus(200);
      return;
    }

    try {
      const result = await live.acceptIncoming(event);
      if (!result.handled) {
        console.warn("CallPilot incoming call was not accepted", result);
        res.status(202).json(result);
        return;
      }
      res.status(200).json({
        accepted: true,
        business_id: result.businessId,
        session_id: result.sessionId
      });
    } catch (error: any) {
      console.error("CallPilot incoming call error", {
        eventId: String(event.id || ""),
        message: String(error?.message || error).slice(0, 300)
      });
      res.status(502).send("Unable to accept call");
    }
  }
);

app.use(express.json({ limit: "256kb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "callpilot-voice-backend",
    time: new Date().toISOString()
  });
});

app.get("/setup-status", (_req, res) => {
  res.json(setupStatus());
});

app.get("/api/businesses", requireAdmin, (_req, res) => {
  res.json({ businesses: store.listBusinesses() });
});

app.post("/api/businesses", requireAdmin, (req, res) => {
  try {
    const input = businessFromBody(req.body);
    if (!input.id || !input.name || !input.callpilotNumber) {
      res.status(400).json({
        error: "id, name and callpilotNumber are required"
      });
      return;
    }
    const business = store.upsertBusiness(input);
    res.status(201).json({ business });
  } catch (error: any) {
    res.status(400).json({
      error: String(error?.message || error).slice(0, 250)
    });
  }
});

app.get("/api/businesses/:id", requireAdmin, (req, res) => {
  const business = store.getBusiness(routeId(req));
  if (!business) {
    res.sendStatus(404);
    return;
  }
  res.json({ business });
});

app.patch("/api/businesses/:id", requireAdmin, (req, res) => {
  const existing = store.getBusiness(routeId(req));
  if (!existing) {
    res.sendStatus(404);
    return;
  }
  try {
    const business = store.upsertBusiness(
      businessFromBody({ ...req.body, id: existing.id }, existing)
    );
    res.json({ business });
  } catch (error: any) {
    res.status(400).json({
      error: String(error?.message || error).slice(0, 250)
    });
  }
});

app.get("/api/businesses/:id/calls", requireAdmin, (req, res) => {
  if (!store.getBusiness(routeId(req))) {
    res.sendStatus(404);
    return;
  }
  res.json({ calls: store.listCalls(routeId(req)) });
});

app.get("/api/businesses/:id/leads", requireAdmin, (req, res) => {
  if (!store.getBusiness(routeId(req))) {
    res.sendStatus(404);
    return;
  }
  res.json({ leads: store.listLeads(routeId(req)) });
});

app.get(
  "/api/businesses/:id/appointments",
  requireAdmin,
  (req, res) => {
    if (!store.getBusiness(routeId(req))) {
      res.sendStatus(404);
      return;
    }
    res.json({ appointments: store.listAppointments(routeId(req)) });
  }
);

app.get(
  "/api/businesses/:id/availability",
  requireAdmin,
  (req, res) => {
    const business = store.getBusiness(routeId(req));
    if (!business) {
      res.sendStatus(404);
      return;
    }
    res.json({
      business_id: business.id,
      calendar_mode: business.calendarMode,
      timezone: business.timezone,
      slots: store.availableSlots(business.id, 12)
    });
  }
);

app.get("/api/appointments", requireAdmin, (_req, res) => {
  res.json({
    appointments: store.listAppointments(DEFAULT_BUSINESS_ID)
  });
});

app.get("/api/leads", requireAdmin, (_req, res) => {
  res.json({ leads: store.listLeads(DEFAULT_BUSINESS_ID) });
});

app.get("/api/calls", requireAdmin, (_req, res) => {
  res.json({ calls: store.listCalls(DEFAULT_BUSINESS_ID) });
});

app.post("/api/test-booking", (req, res) => {
  if (!DEMO_MODE) {
    res.status(404).json({ error: "disabled" });
    return;
  }

  const businessId = String(
    req.body?.businessId || DEFAULT_BUSINESS_ID
  );
  const business = store.getBusiness(businessId);
  if (!business) {
    res.status(404).json({ error: "unknown_business" });
    return;
  }

  const slot = store.availableSlots(business.id, 1)[0];
  if (!slot) {
    res.status(409).json({
      error:
        business.calendarMode === "lead_only"
          ? "calendar_not_connected"
          : "no_demo_slot_available"
    });
    return;
  }

  const sessionId = "demo_" + Date.now();
  store.upsertCall(
    sessionId,
    business.id,
    "+15145550123",
    business.callpilotNumber,
    undefined,
    "demo"
  );

  const lead = {
    issue: String(req.body?.issue || "Furnace stopped working"),
    urgency: "regular" as const,
    city: String(req.body?.city || "Kirkland"),
    address: String(req.body?.address || "123 Main Street"),
    phone: String(req.body?.phone || "514-555-0123"),
    name: String(req.body?.name || "Demo Customer"),
    language:
      req.body?.language === "fr" ? ("fr" as const) : ("en" as const)
  };

  store.saveLead(business.id, sessionId, lead);
  const booking = store.bookAppointment(sessionId, {
    ...lead,
    businessId: business.id,
    slotId: slot.id,
    confirmedByCaller: true
  });

  res.status(booking.success ? 200 : 409).json({
    business: business.name,
    booking
  });
});

app.get("/", (_req, res) => {
  const status = setupStatus();
  const ready = status.ready_for_real_calls;
  const businesses = store.listBusinesses();

  const businessRows = businesses
    .map(
      (b) => `<tr>
<td>${escapeHtml(b.name)}</td>
<td><code>${escapeHtml(b.callpilotNumber)}</code></td>
<td>${escapeHtml(b.trade)}</td>
<td>${escapeHtml(b.calendarMode)}</td>
<td>${b.active ? "Active" : "Paused"}</td>
</tr>`
    )
    .join("");

  const missingHtml =
    status.missing.length === 0
      ? "<li>OpenAI credentials are configured.</li>"
      : status.missing
          .map((m) => `<li>${escapeHtml(m)}</li>`)
          .join("");

  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CallPilot Voice Backend</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#0d1520;color:#eef4fb;margin:0;padding:40px}
main{max-width:920px;margin:auto}
.card{background:#142131;border:1px solid #2a3b51;border-radius:18px;padding:24px;margin:16px 0}
.badge{display:inline-block;padding:7px 11px;border-radius:999px;background:${ready ? "#194d37" : "#5b3b17"};font-weight:700}
h1{margin:10px 0}.muted{color:#a9b8c9}code{background:#08111b;padding:3px 6px;border-radius:6px}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:10px;border-bottom:1px solid #26384d}
a{color:#8ecbff}
</style>
</head>
<body><main>
<div class="badge">${ready ? "Real-call credentials present" : "Demo mode / setup required"}</div>
<h1>CallPilot Voice Backend</h1>
<p class="muted">Existing business number → conditional forward → hidden CallPilot number → GPT-Live Ava → business tools.</p>
<div class="card">
<h2>Backend</h2>
<p>Service is running. Demo mode: <b>${DEMO_MODE}</b>. Configured businesses: <b>${businesses.length}</b>.</p>
<p><a href="/health">Health</a> · <a href="/setup-status">Setup status</a></p>
</div>
<div class="card">
<h2>Configured routing profiles</h2>
<table><thead><tr><th>Business</th><th>Hidden number</th><th>Trade</th><th>Calendar</th><th>Status</th></tr></thead>
<tbody>${businessRows || '<tr><td colspan="5">No businesses configured</td></tr>'}</tbody></table>
</div>
<div class="card">
<h2>Before real customer calls can reach Ava</h2>
<ol>
<li>Add the OpenAI API key, project ID and webhook signing secret to the backend host.</li>
<li>Create an OpenAI project webhook for <code>live.transport.incoming</code> pointing to <code>/webhooks/openai</code>.</li>
<li>Create a secure Twilio Elastic SIP Trunk and point its Origination URI to <code>${escapeHtml(status.sip_target || "sip:YOUR_PROJECT_ID@sip.api.openai.com;transport=tls")}</code>.</li>
<li>Attach one hidden Twilio number per business and store that E.164 number in its CallPilot profile.</li>
<li>Configure each business's existing carrier number to conditionally forward unanswered/after-hours calls to its hidden CallPilot number.</li>
</ol>
<h3>Missing environment items</h3><ul>${missingHtml}</ul>
</div>
</main></body></html>`);
});

const server = app.listen(PORT, () => {
  console.log("CallPilot Voice Backend listening", {
    port: PORT,
    demoMode: DEMO_MODE,
    businessCount: store.listBusinesses().length,
    realCallsConfigured: setupStatus().ready_for_real_calls
  });
});

function shutdown() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
