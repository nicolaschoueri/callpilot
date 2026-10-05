import { describe, it, expect } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { browserVoiceRouter, demoVoiceInstructions } from "../src/browser-voice.js";

async function withServer(options: Parameters<typeof browserVoiceRouter>[0], run: (url: string) => Promise<void>) {
  const app = express(); app.use(browserVoiceRouter(options));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/session`); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
const headers = { Origin: "https://nicolaschoueri.github.io", Authorization: "Bearer demo-code", "Content-Type": "application/json" };
const options = { apiKey: "server-secret", accessToken: "demo-code", allowedOrigins: [headers.Origin] };

describe("website voice connection", () => {
  it("does not call a paid service until configured and authenticated", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => { calls++; return new Response("v=0\r\n"); };
    await withServer({ ...options, apiKey: "", fetchImpl }, async url => {
      expect((await fetch(url, { method: "POST", headers, body: JSON.stringify({ sdp: "v=0" }) })).status).toBe(503);
    });
    await withServer({ ...options, fetchImpl }, async url => {
      expect((await fetch(url, { method: "POST", headers: { ...headers, Authorization: "Bearer wrong" }, body: JSON.stringify({ sdp: "v=0" }) })).status).toBe(401);
      expect((await fetch(url, { method: "POST", headers: { ...headers, Origin: "https://other.example" }, body: JSON.stringify({ sdp: "v=0" }) })).status).toBe(403);
    });
    expect(calls).toBe(0);
  });
  it("keeps credentials server-side and uses the selected language with one voice", async () => {
    const fetchImpl: typeof fetch = async (_url, init) => {
      expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer server-secret");
      const form = init!.body as FormData;
      const session = JSON.parse(String(form.get("session")));
      expect(session.instructions).toContain("natural Canadian French");
      expect(session.audio.output.voice).toBe("marin");
      expect(session.audio.input.turn_detection.interrupt_response).toBe(true);
      return new Response("v=0\r\ns=answer\r\n");
    };
    await withServer({ ...options, fetchImpl }, async url => {
      const response = await fetch(url, { method: "POST", headers, body: JSON.stringify({ sdp: "v=0\r\n", lang: "fr" }) });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("v=0\r\ns=answer\r\n");
    });
  });
  it("rejects invalid offers, limits retries, and conceals upstream failures", async () => {
    await withServer({ ...options, fetchImpl: async () => new Response("private upstream details", { status: 401 }) }, async url => {
      expect((await fetch(url, { method: "POST", headers, body: JSON.stringify({ sdp: "invalid" }) })).status).toBe(400);
      for (let i = 0; i < 3; i++) {
        const response = await fetch(url, { method: "POST", headers, body: JSON.stringify({ sdp: "v=0" }) });
        expect(response.status).toBe(502); expect(await response.text()).not.toContain("private upstream");
      }
      expect((await fetch(url, { method: "POST", headers, body: JSON.stringify({ sdp: "v=0" }) })).status).toBe(429);
    });
    expect(demoVoiceInstructions("en")).toContain("Never claim a technician has been dispatched");
  });
});
