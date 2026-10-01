import OpenAI from "openai";
import WebSocket from "ws";
import type { IncomingHttpHeaders } from "node:http";
import { backendPrompt, livePrompt } from "./prompts.js";
import { responseTools, executeToolIdempotently } from "./tools.js";
import type { CallPilotStore } from "./store.js";

export type LiveConfig = {
  apiKey: string;
  webhookSecret: string;
  businessName: string;
  ownerFirstName: string;
  ownerTransferUri?: string;
  store: CallPilotStore;
};

function callerIdFromSipHeaders(headers: any[] | undefined) {
  const from = headers?.find((h) => String(h?.name || "").toLowerCase() === "from")?.value;
  const match = String(from || "").match(/\+\d{7,15}/);
  return match?.[0];
}

export class CallPilotLive {
  private client: OpenAI;

  constructor(private config: LiveConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey || "not-configured",
      webhookSecret: config.webhookSecret || undefined
    });
  }

  verifyWebhook(rawBody: string, headers: IncomingHttpHeaders) {
    return this.client.webhooks.unwrap(rawBody, headers as any, this.config.webhookSecret) as Promise<any>;
  }

  async acceptIncoming(event: any) {
    if (event.type !== "live.transport.incoming" || event.data?.type !== "sip") {
      return { handled: false as const };
    }

    const sessionId = String(event.data?.session_id || "");
    if (!sessionId) throw new Error("Missing Live session_id");

    const callerId = callerIdFromSipHeaders(event.data?.sip_headers);
    this.config.store.upsertCall(sessionId, callerId, event.id, "incoming");

    const body = {
      session: {
        type: "live",
        model: "gpt-live-1",
        instructions: livePrompt(this.config.businessName, this.config.ownerFirstName, callerId),
        audio: { output: { voice: "marin" } },
        delegation: {
          type: "responses",
          responses: {
            model: "gpt-6-luna",
            instructions: backendPrompt(this.config.businessName),
            tools: responseTools,
            tool_choice: "auto",
            parallel_tool_calls: false
          }
        }
      }
    };

    const response = await fetch(
      `https://api.openai.com/v1/live/sessions/${encodeURIComponent(sessionId)}/accept`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      }
    );

    if (!response.ok) {
      const detail = await response.text();
      this.config.store.setCallStatus(sessionId, "accept_error");
      throw new Error(`OpenAI Live accept failed (${response.status}): ${detail.slice(0, 300)}`);
    }

    this.config.store.setCallStatus(sessionId, "accepted");
    this.attachSideband(sessionId);
    return { handled: true as const, sessionId, callerId };
  }

  private attachSideband(sessionId: string) {
    const ws = new WebSocket(
      `wss://api.openai.com/v1/live/sessions/${encodeURIComponent(sessionId)}/attach`,
      { headers: { Authorization: `Bearer ${this.config.apiKey}` } }
    );

    ws.on("open", () => {
      this.config.store.setCallStatus(sessionId, "connected");
    });

    ws.on("message", async (raw) => {
      let envelope: any;
      try {
        envelope = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (envelope.type === "response.event") {
        const inner = envelope.event;
        if (inner?.type === "response.output_item.done" && inner?.item?.type === "function_call") {
          const item = inner.item;
          let args: any = {};
          try {
            args = JSON.parse(item.arguments || "{}");
          } catch {
            args = {};
          }

          const result = await executeToolIdempotently(
            String(item.call_id),
            String(item.name),
            args,
            {
              sessionId,
              store: this.config.store,
              transfer: (reason) => this.transferToOwner(sessionId, reason)
            }
          );

          ws.send(
            JSON.stringify({
              type: "response.item.create",
              event_id: "tool_result_" + item.call_id,
              item: {
                type: "function_call_output",
                call_id: item.call_id,
                output: JSON.stringify(result)
              }
            })
          );

          ws.send(
            JSON.stringify({
              type: "response.create",
              event_id: "continue_" + item.call_id
            })
          );
        }
      }

      if (envelope.type === "session.closed") {
        this.config.store.setCallStatus(sessionId, "closed");
        ws.close();
      }
    });

    ws.on("error", (error) => {
      this.config.store.setCallStatus(sessionId, "sideband_error");
      console.error("GPT-Live sideband error", {
        sessionId,
        message: String((error as Error)?.message || "websocket error").slice(0, 200)
      });
    });

    ws.on("close", () => {
      const row = this.config.store.db
        .prepare("SELECT status FROM calls WHERE session_id=?")
        .get(sessionId) as { status: string } | undefined;
      if (row && row.status !== "closed") this.config.store.setCallStatus(sessionId, "disconnected");
    });
  }

  async transferToOwner(sessionId: string, _reason: string) {
    const target = this.config.ownerTransferUri;
    if (!target) return { success: false, reason: "owner_transfer_unavailable" };

    const response = await fetch(
      `https://api.openai.com/v1/live/sessions/${encodeURIComponent(sessionId)}/refer`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ target_uri: target })
      }
    );

    if (!response.ok) {
      return { success: false, reason: "transfer_failed", status: response.status };
    }

    return { success: true };
  }
}
