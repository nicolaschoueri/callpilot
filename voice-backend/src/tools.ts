import type { CallPilotStore, LeadInput } from "./store.js";

export const responseTools = [
  {
    type: "function",
    name: "save_lead",
    description: "Save the caller's service request details once the contact details are known.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        issue: { type: "string" },
        urgency: { type: "string", enum: ["regular", "emergency"] },
        city: { type: "string" },
        address: { type: "string" },
        phone: { type: "string" },
        name: { type: "string" },
        language: { type: "string", enum: ["en", "fr"] }
      },
      required: ["issue", "urgency", "city", "address", "phone", "name", "language"]
    }
  },
  {
    type: "function",
    name: "check_availability",
    description: "Return currently available appointment slots. Only offer slots returned by this tool.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        preferred_day: { type: "string" },
        preferred_time: { type: "string" }
      }
    }
  },
  {
    type: "function",
    name: "book_appointment",
    description: "Book one exact slot after the caller explicitly confirms it. Never call this before confirmation.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        slot_id: { type: "string" },
        confirmed_by_caller: { type: "boolean" },
        issue: { type: "string" },
        urgency: { type: "string", enum: ["regular", "emergency"] },
        city: { type: "string" },
        address: { type: "string" },
        phone: { type: "string" },
        name: { type: "string" },
        language: { type: "string", enum: ["en", "fr"] }
      },
      required: [
        "slot_id",
        "confirmed_by_caller",
        "issue",
        "urgency",
        "city",
        "address",
        "phone",
        "name",
        "language"
      ]
    }
  },
  {
    type: "function",
    name: "request_emergency_dispatch",
    description: "Check same-day emergency dispatch windows. This returns availability only; it does not itself promise a technician.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        issue: { type: "string" },
        city: { type: "string" },
        address: { type: "string" },
        phone: { type: "string" },
        name: { type: "string" },
        language: { type: "string", enum: ["en", "fr"] }
      },
      required: ["issue", "city", "address", "phone", "name", "language"]
    }
  },
  {
    type: "function",
    name: "transfer_to_owner",
    description: "Ask the phone platform to transfer the current call to the business owner when escalation is needed.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        reason: { type: "string" }
      },
      required: ["reason"]
    }
  }
] as const;

export type ToolContext = {
  sessionId: string;
  store: CallPilotStore;
  transfer: (reason: string) => Promise<unknown>;
};

function asLeadInput(args: any): LeadInput {
  return {
    issue: String(args.issue || ""),
    urgency: args.urgency === "emergency" ? "emergency" : "regular",
    city: String(args.city || ""),
    address: String(args.address || ""),
    phone: String(args.phone || ""),
    name: String(args.name || ""),
    language: args.language === "fr" ? "fr" : "en"
  };
}

export async function executeTool(name: string, args: any, ctx: ToolContext) {
  if (name === "save_lead") {
    return ctx.store.saveLead(ctx.sessionId, asLeadInput(args));
  }

  if (name === "check_availability") {
    return {
      success: true,
      timezone: ctx.store.timezone,
      slots: ctx.store.availableSlots(5)
    };
  }

  if (name === "book_appointment") {
    const lead = asLeadInput(args);
    return ctx.store.bookAppointment(ctx.sessionId, {
      ...lead,
      slotId: String(args.slot_id || ""),
      confirmedByCaller: args.confirmed_by_caller === true
    });
  }

  if (name === "request_emergency_dispatch") {
    return {
      success: true,
      timezone: ctx.store.timezone,
      windows: ctx.store.emergencyWindows(),
      note: "These are availability options only. The caller still needs to select a window."
    };
  }

  if (name === "transfer_to_owner") {
    return ctx.transfer(String(args.reason || "caller requested escalation"));
  }

  return { success: false, reason: "unknown_tool" };
}

export async function executeToolIdempotently(
  toolCallId: string,
  name: string,
  args: any,
  ctx: ToolContext
) {
  const prior = ctx.store.getToolResult(toolCallId);
  if (prior) return prior;

  const result = await executeTool(name, args, ctx);
  ctx.store.saveToolResult(toolCallId, ctx.sessionId, name, result);
  return result;
}
