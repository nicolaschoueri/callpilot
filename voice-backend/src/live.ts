import OpenAI from "openai";
import WebSocket from "ws";
import type { IncomingHttpHeaders } from "node:http";
import { backendPrompt, livePrompt } from "./prompts.js";
import { responseTools, executeToolIdempotently } from "./tools.js";
import type { BusinessProfile, CallPilotStore } from "./store.js";
import type { OwnerNotifier } from "./notifications.js";

export type LiveConfig = {
  apiKey: string;
  webhookSecret: string;
  store: CallPilotStore;
  notifier?: OwnerNotifier;
  defaultBusinessId?: string;
  allowSingleBusinessFallback?: boolean;
};

function phoneFromHeaderValue(value: unknown) {
  const match = String(value || "").match(/\+\d{7,15}/);
  return match?.[0];
}

function phoneFromSipHeaders(headers: any[] | undefined, names: string[]) {
  for (const name of names) {
    const header = headers?.find(
      (h) => String(h?.name || "").toLowerCase() === name.toLowerCase()
    );
    const number = phoneFromHeaderValue(header?.value);
    if (number) return number;
  }
  return undefined;
}

function callerIdFromSipHeaders(headers: any[] | undefined) {
  return phoneFromSipHeaders(headers, [
    "P-Asserted-Identity",
    "Remote-Party-ID",
    "From"
  ]);
}

function destinationFromSipHeaders(headers: any[] | undefined) {
  // Twilio Elastic SIP Trunking guarantees the originally dialed Twilio
  // number in Diversion on origination calls. P-Called-Party-ID and To
  // are useful fallbacks for other providers.
  return phoneFromSipHeaders(headers, [
    "Diversion",
    "P-Called-Party-ID",
    "To"
  ]);
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
    return this.client.webhooks.unwrap(
      rawBody,
      headers as any,
      this.config.webhookSecret
    ) as Promise<any>;
  }

  private resolveBusiness(destinationNumber: string | undefined) {
    const direct = this.config.store.resolveBusinessByDestination(destinationNumber);
    if (direct) return direct;

    if (this.config.allowSingleBusinessFallback && this.config.defaultBusinessId) {
      return this.config.store.getBusiness(this.config.defaultBusinessId);
    }
    return undefined;
  }

  async acceptIncoming(event: any) {
    if (event.type !== "live.transport.incoming" || event.data?.type !== "sip") {
      return { handled: false as const, reason: "unsupported_event" };
    }

    const sessionId = String(event.data?.session_id || "");
    if (!sessionId) throw new Error("Missing Live session_id");

    const sipHeaders = event.data?.sip_headers as any[] | undefined;
    const callerId = callerIdFromSipHeaders(sipHeaders);
    const destinationNumber = destinationFromSipHeaders(sipHeaders);
    const business = this.resolveBusiness(destinationNumber);

    if (!business || !business.active) {
      console.warn("CallPilot could not route incoming call", {
        sessionId,
        destinationNumber: destinationNumber || null
      });
      return {
        handled: false as const,
        reason: "business_not_found",
        destinationNumber
      };
    }

    this.config.store.upsertCall(
      sessionId,
      business.id,
      callerId,
      destinationNumber,
      event.id,
      "incoming"
    );

    const body = {
      session: {
        type: "live",
        model: "gpt-live-1",
        instructions: livePrompt(business, callerId),
        audio: { output: { voice: "marin" } },
        delegation: {
          type: "responses",
          responses: {
            model: "gpt-6-luna",
            instructions: backendPrompt(business),
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
      throw new Error(
        `OpenAI Live accept failed (${response.status}): ${detail.slice(0, 300)}`
      );
    }

    this.config.store.setCallStatus(sessionId, "accepted");
    this.attachSideband(sessionId, business);
    return {
      handled: true as const,
      sessionId,
      callerId,
      destinationNumber,
      businessId: business.id
    };
  }

  private attachSideband(sessionId: string, business: BusinessProfile) {
    const ws = new WebSocket(
      `wss://api.openai.com/v1/live/sessions/${encodeURIComponent(sessionId)}/attach`,
      { headers: { Authorization: `Bearer ${this.config.apiKey}` } }
    );

    ws.on("open", () => {
      this.config.store.setCallStatus(sessionId, "connected");

      // Always begin the call with the bilingual keypad menu.
      ws.send(
        JSON.stringify({
          type: "response.create",
          event_id: "language_menu_" + sessionId,
          response: {
            instructions:
              'Say exactly: "Pour le français, appuyez sur 1. For English, press 2." Then stop speaking and wait for the caller to choose a language.'
          }
        })
      );
    });

    ws.on("message", async (raw) => {
      let envelope: any;
      try {
        envelope = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (envelope.type === "input_audio_buffer.dtmf_event_received") {
        const key = String(envelope.event || "");
        if (key === "1" || key === "2") {
          const french = key === "1";
          const languageInstruction = french
            ? "The caller selected French with keypad 1. From now on, speak only natural Canadian French unless the caller explicitly asks to switch languages."
            : "The caller selected English with keypad 2. From now on, speak only English unless the caller explicitly asks to switch languages.";

          ws.send(
            JSON.stringify({
              type: "conversation.item.create",
              event_id: "language_choice_" + sessionId + "_" + key,
              item: {
                type: "message",
                role: "system",
                content: [{ type: "input_text", text: languageInstruction }]
              }
            })
          );

          ws.send(
            JSON.stringify({
              type: "response.create",
              event_id: "language_ack_" + sessionId + "_" + key,
              response: {
                instructions: french
                  ? `The caller selected French. Say exactly: "Merci d'avoir appelé ${business.name}. Je suis Ava. Comment puis-je vous aider aujourd'hui?" Then continue the call naturally in Canadian French.`
                  : `The caller selected English. Say exactly: "Thank you for calling ${business.name}. I'm Ava. How can I help you today?" Then continue the call naturally in English.`
              }
            })
          );
        }
        return;
      }

      if (envelope.type === "response.event") {
        const inner = envelope.event;
        if (
          inner?.type === "response.output_item.done" &&
          inner?.item?.type === "function_call"
        ) {
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
              business,
              store: this.config.store,
              transfer: (reason) =>
                this.transferToOwner(sessionId, business, reason),
              notifyOwner: this.config.notifier
                ? (kind, details) =>
                    this.config.notifier!.notify(business, kind, details)
                : undefined
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
        businessId: business.id,
        message: String((error as Error)?.message || "websocket error").slice(0, 200)
      });
    });

    ws.on("close", () => {
      const row = this.config.store.getCall(sessionId) as { status?: string } | undefined;
      if (row && row.status !== "closed") {
        this.config.store.setCallStatus(sessionId, "disconnected");
      }
    });
  }

  async transferToOwner(
    sessionId: string,
    business: BusinessProfile,
    _reason: string
  ) {
    const target =
      business.ownerTransferUri ||
      (business.ownerPhone ? `tel:${business.ownerPhone}` : "");

    if (!target) {
      return { success: false, reason: "owner_transfer_unavailable" };
    }

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
      return {
        success: false,
        reason: "transfer_failed",
        status: response.status
      };
    }

    return { success: true };
  }
}
