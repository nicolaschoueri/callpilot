import "dotenv/config";
import express from "express";
import { CallPilotStore } from "./store.js";
import { CallPilotLive } from "./live.js";

const PORT = Number(process.env.PORT || 3000);
const DEMO_MODE = String(process.env.DEMO_MODE ?? "true").toLowerCase() === "true";
const BUSINESS_NAME = process.env.BUSINESS_NAME || "CallPilot Trades";
const OWNER_FIRST_NAME = process.env.OWNER_FIRST_NAME || "John";
const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || "America/Toronto";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_WEBHOOK_SECRET = process.env.OPENAI_WEBHOOK_SECRET || "";
const OPENAI_PROJECT_ID = process.env.OPENAI_PROJECT_ID || "";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const OWNER_TRANSFER_URI =
  process.env.OWNER_TRANSFER_URI ||
  (process.env.OWNER_PHONE ? `tel:${process.env.OWNER_PHONE}` : "");

const store = new CallPilotStore(process.env.CALLPILOT_DB_PATH, BUSINESS_TIMEZONE);
const live =
  OPENAI_API_KEY && OPENAI_WEBHOOK_SECRET
    ? new CallPilotLive({
        apiKey: OPENAI_API_KEY,
        webhookSecret: OPENAI_WEBHOOK_SECRET,
        businessName: BUSINESS_NAME,
        ownerFirstName: OWNER_FIRST_NAME,
        ownerTransferUri: OWNER_TRANSFER_URI || undefined,
        store
      })
    : null;

function setupStatus() {
  const required: Array<[string, string]> = [
    ["OPENAI_API_KEY", OPENAI_API_KEY],
    ["OPENAI_WEBHOOK_SECRET", OPENAI_WEBHOOK_SECRET],
    ["OPENAI_PROJECT_ID", OPENAI_PROJECT_ID]
  ];
  const missing = required.filter(([, value]) => !value).map(([key]) => key);
  return {
    backend_running: true,
    demo_mode: DEMO_MODE,
    ready_for_real_calls: missing.length === 0,
    business_name: BUSINESS_NAME,
    owner_first_name: OWNER_FIRST_NAME,
    timezone: BUSINESS_TIMEZONE,
    missing,
    external_setup_still_required: [
      "OpenAI project webhook subscribed to live.transport.incoming",
      "SIP trunk/hidden CallPilot number routed to the OpenAI SIP project endpoint",
      "Business owner's existing phone configured for conditional no-answer forwarding to the hidden CallPilot number"
    ],
    sip_target: OPENAI_PROJECT_ID
      ? `sip:${OPENAI_PROJECT_ID}@sip.api.openai.com;transport=tls`
      : null
  };
}

function adminAllowed(req: express.Request) {
  if (!ADMIN_TOKEN) return DEMO_MODE;
  return req.headers.authorization === `Bearer ${ADMIN_TOKEN}`;
}

const app = express();

app.post("/webhooks/openai", express.text({ type: "application/json" }), async (req, res) => {
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
    res.status(result.handled ? 200 : 202).send(result.handled ? "accepted" : "ignored");
  } catch (error: any) {
    console.error("CallPilot incoming call error", {
      eventId: String(event.id || ""),
      message: String(error?.message || error).slice(0, 300)
    });
    res.status(502).send("Unable to accept call");
  }
});

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "callpilot-voice-backend", time: new Date().toISOString() });
});

app.get("/setup-status", (_req, res) => {
  res.json(setupStatus());
});

app.get("/api/appointments", (req, res) => {
  if (!adminAllowed(req)) {
    res.sendStatus(403);
    return;
  }
  res.json({ appointments: store.listAppointments() });
});

app.get("/api/leads", (req, res) => {
  if (!adminAllowed(req)) {
    res.sendStatus(403);
    return;
  }
  res.json({ leads: store.listLeads() });
});

app.post("/api/test-booking", (req, res) => {
  if (!DEMO_MODE) {
    res.status(404).json({ error: "disabled" });
    return;
  }

  const slot = store.availableSlots(1)[0];
  if (!slot) {
    res.status(409).json({ error: "no_demo_slot_available" });
    return;
  }

  const sessionId = "demo_" + Date.now();
  store.upsertCall(sessionId, "+15145550123", undefined, "demo");
  const lead = {
    issue: String(req.body?.issue || "Furnace stopped working"),
    urgency: "regular" as const,
    city: String(req.body?.city || "Kirkland"),
    address: String(req.body?.address || "123 Main Street"),
    phone: String(req.body?.phone || "514-555-0123"),
    name: String(req.body?.name || "Demo Customer"),
    language: req.body?.language === "fr" ? ("fr" as const) : ("en" as const)
  };
  store.saveLead(sessionId, lead);
  const booking = store.bookAppointment(sessionId, {
    ...lead,
    slotId: slot.id,
    confirmedByCaller: true
  });
  res.status(booking.success ? 200 : 409).json({ booking });
});

app.get("/", (_req, res) => {
  const status = setupStatus();
  const ready = status.ready_for_real_calls;
  const missingHtml =
    status.missing.length === 0
      ? "<li>OpenAI credentials are configured.</li>"
      : status.missing.map((m) => `<li>${m}</li>`).join("");

  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CallPilot Voice Backend</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#0d1520;color:#eef4fb;margin:0;padding:40px}
main{max-width:820px;margin:auto}
.card{background:#142131;border:1px solid #2a3b51;border-radius:18px;padding:24px;margin:16px 0}
.badge{display:inline-block;padding:7px 11px;border-radius:999px;background:${ready ? "#194d37" : "#5b3b17"};font-weight:700}
h1{margin:10px 0}.muted{color:#a9b8c9}code{background:#08111b;padding:3px 6px;border-radius:6px}
</style>
</head>
<body><main>
<div class="badge">${ready ? "Real-call credentials present" : "Demo mode / setup required"}</div>
<h1>CallPilot Voice Backend</h1>
<p class="muted">Missed call → Ava → qualification → availability → confirmed appointment.</p>
<div class="card">
<h2>Backend</h2>
<p>Service is running. Demo mode: <b>${DEMO_MODE}</b>. Time zone: <b>${BUSINESS_TIMEZONE}</b>.</p>
<p><a href="/health" style="color:#8ecbff">Health</a> · <a href="/setup-status" style="color:#8ecbff">Setup status</a></p>
</div>
<div class="card">
<h2>Before real customer calls can reach Ava</h2>
<ol>
<li>Add the OpenAI API key, project ID, and webhook signing secret.</li>
<li>Create an OpenAI project webhook for <code>live.transport.incoming</code> pointing to <code>/webhooks/openai</code>.</li>
<li>Route the hidden CallPilot/SIP number to <code>${status.sip_target || "sip:YOUR_PROJECT_ID@sip.api.openai.com;transport=tls"}</code>.</li>
<li>Configure the business owner's existing carrier number to conditionally forward unanswered calls to the hidden CallPilot number.</li>
</ol>
<h3>Missing environment items</h3><ul>${missingHtml}</ul>
</div>
</main></body></html>`);
});

const server = app.listen(PORT, () => {
  console.log("CallPilot Voice Backend listening", {
    port: PORT,
    demoMode: DEMO_MODE,
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
