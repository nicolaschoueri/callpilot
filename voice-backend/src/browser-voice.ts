import express from "express";
import crypto from "node:crypto";

export function demoVoiceInstructions(lang: string) {
  return `You are Ava, a warm, professional receptionist for CallPilot Trades. This is a WEBSITE DEMO only. Speak ${lang === "fr" ? "natural Canadian French" : "English"} throughout the call. Keep one consistent voice. Start by greeting the caller and asking what service they need. Ask ONE short question at a time and wait for the answer. Allow interruptions and corrections. Remember information already given. Do not repeat questions whose answers you know.
Identify whether the caller is a homeowner, contractor, property manager or commercial customer. Adapt questions accordingly. Collect the service problem, urgency, city, FULL service address, callback phone number, contact name, and preferred DATE AND TIME. Explicitly confirm the phone number and address. For contractors also collect company, site contact, access requirements and optional purchase order or job number. For property managers collect building, unit, access and authorization. For commercial callers collect company and site contact. A street number or phone number is NOT a preferred appointment time.
For urgent requests ask whether same-day service is needed and the preferred dispatch time. Never claim a technician has been dispatched. For immediate danger such as fire, gas smell or electrical arcing, advise local emergency services as appropriate.
Calendars are optional. This demo has no real calendar, dispatch or SMS connection. Collect a REQUEST for the owner to confirm. Never invent available slots, prices or appointments; never say anything was booked, sent, saved or cancelled in a real system. Explain that this is a simulated service request when summarizing. For cancellation or rescheduling collect contact, original appointment and requested change, with confirmation pending. Finish by reading back the details and asking the caller to confirm or correct them.`;
}

export function browserVoiceRouter(options: {
  apiKey: string;
  accessToken: string;
  allowedOrigins: string[];
  // Only set after the original EN/FR voices have been matched and approved.
  approvedVoices?: { en?: string; fr?: string };
  fetchImpl?: typeof fetch;
}) {
  const router = express.Router();
  const attempts = new Map<string, number[]>();
  router.use((req, res, next) => {
    const origin = req.headers.origin;
    if (!origin || !options.allowedOrigins.includes(origin)) {
      res.status(403).json({ error: "Voice demo origin not allowed" }); return;
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    if (!options.apiKey || !options.accessToken) {
      res.status(503).json({ error: "Live voice is not connected yet" }); return;
    }
    const actual = Buffer.from(req.headers.authorization || "");
    const expected = Buffer.from(`Bearer ${options.accessToken}`);
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      res.status(401).json({ error: "Enter the voice demo access code" }); return;
    }
    next();
  });
  router.post("/session", express.json({ limit: "64kb" }), async (req, res) => {
    if (typeof req.body?.sdp !== "string" || !req.body.sdp.startsWith("v=0")) {
      res.status(400).json({ error: "Invalid voice connection offer" }); return;
    }
    const voice = options.approvedVoices?.[req.body.lang === 'fr' ? 'fr' : 'en'];
    if (!voice) {
      res.status(503).json({ error: "The original Ava voice has not been connected" }); return;
    }
    const now = Date.now();
    for (const [ip, times] of attempts) if (!times.some(t => now - t < 60_000)) attempts.delete(ip);
    const ip = req.ip || "unknown";
    const recent = (attempts.get(ip) || []).filter(t => now - t < 60_000);
    if (recent.length >= 3) { res.status(429).json({ error: "Please wait before starting another call" }); return; }
    attempts.set(ip, [...recent, now]);
    const form = new FormData();
    form.set("sdp", req.body.sdp);
    form.set("session", JSON.stringify({
      type: "realtime", model: "gpt-realtime-2.1",
      instructions: demoVoiceInstructions(req.body.lang),
      max_output_tokens: 500,
      audio: {
        input: { transcription: { model: "gpt-4o-mini-transcribe", language: req.body.lang === "fr" ? "fr" : "en" }, turn_detection: { type: "semantic_vad", eagerness: "low", create_response: true, interrupt_response: true } },
        output: { voice }
      }
    }));
    try {
      const upstream = await (options.fetchImpl || fetch)("https://api.openai.com/v1/realtime/calls", {
        method: "POST", headers: { Authorization: `Bearer ${options.apiKey}` },
        body: form, signal: AbortSignal.timeout(20_000)
      });
      if (!upstream.ok) { res.status(502).json({ error: "Voice service could not connect" }); return; }
      const sdp = await upstream.text();
      if (!sdp.startsWith("v=0")) { res.status(502).json({ error: "Invalid voice service response" }); return; }
      res.type("application/sdp").send(sdp);
    } catch { res.status(502).json({ error: "Voice service timed out. Please try again" }); }
  });
  return router;
}
