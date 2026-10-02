import type { BusinessProfile, CallPilotStore, LeadInput } from "./store.js";

export const responseTools = [
  {
    type: "function",
    name: "check_service_area",
    description: "Check whether the caller's city is inside this business's configured service area.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { city: { type: "string" } },
      required: ["city"]
    }
  },
  {
    type: "function",
    name: "save_lead",
    description: "Save the caller's service request once the contact details are known.",
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
        language: { type: "string", enum: ["en", "fr"] },
        preferred_day: { type: "string" },
        preferred_time: { type: "string" }
      },
      required: ["issue", "urgency", "city", "address", "phone", "name", "language"]
    }
  },
  {
    type: "function",
    name: "check_availability",
    description:
      "Return currently available appointment slots. If this business has no connected calendar, returns lead_only mode instead. Only offer slots actually returned by this tool.",
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
    description:
      "Book one exact slot after the caller explicitly confirms it. Never call this before confirmation and never use it in lead_only mode.",
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
    description:
      "Return same-day emergency dispatch options for this business. These are options only; do not promise a technician until the caller selects one and the business workflow confirms it.",
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
    description:
      "Transfer the current call to this business's owner when the caller asks for a human or the configured escalation workflow requires it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { reason: { type: "string" } },
      required: ["reason"]
    }
  }
] as const;

export type ToolContext = {
  sessionId: string;
  business: BusinessProfile;
  store: CallPilotStore;
  transfer: (reason: string) => Promise<unknown>;
  notifyOwner?: (kind: "lead" | "booking" | "emergency", details: Record<string, unknown>) => Promise<unknown>;
};

function asLeadInput(args: any): LeadInput {
  return {
    issue: String(args.issue || ""),
    urgency: args.urgency === "emergency" ? "emergency" : "regular",
    city: String(args.city || ""),
    address: String(args.address || ""),
    phone: String(args.phone || ""),
    name: String(args.name || ""),
    language: args.language === "fr" ? "fr" : "en",
    preferredDay: args.preferred_day ? String(args.preferred_day) : undefined,
    preferredTime: args.preferred_time ? String(args.preferred_time) : undefined
  };
}

export async function executeTool(name: string, args: any, ctx: ToolContext) {
  if (name === "check_service_area") {
    return ctx.store.serviceAreaAllowed(ctx.business.id, String(args.city || ""));
  }

  if (name === "save_lead") {
    const lead = asLeadInput(args);
    const area = ctx.store.serviceAreaAllowed(ctx.business.id, lead.city);
    const result = ctx.store.saveLead(ctx.business.id, ctx.sessionId, lead);
    if (result.success && ctx.notifyOwner) {
      await ctx.notifyOwner(lead.urgency === "emergency" ? "emergency" : "lead", {
        ...lead,
        serviceAreaAllowed: area.allowed
      });
    }
    return { ...result, service_area: area };
  }

  if (name === "check_availability") {
    if (ctx.business.calendarMode !== "internal") {
      return {
        success: true,
        mode: "lead_only",
        timezone: ctx.business.timezone,
        slots: [],
        next_action:
          "Collect the caller's preferred day/time, save the lead, and say the business will confirm the appointment. Do not claim a booking."
      };
    }
    return {
      success: true,
      mode: "internal",
      timezone: ctx.business.timezone,
      slots: ctx.store.availableSlots(ctx.business.id, 5)
    };
  }

  if (name === "book_appointment") {
    const lead = asLeadInput(args);
    const result = ctx.store.bookAppointment(ctx.sessionId, {
      ...lead,
      businessId: ctx.business.id,
      slotId: String(args.slot_id || ""),
      confirmedByCaller: args.confirmed_by_caller === true
    });
    if (result.success && ctx.notifyOwner) {
      await ctx.notifyOwner("booking", { ...lead, appointment: result });
    }
    return result;
  }

  if (name === "request_emergency_dispatch") {
    const city = String(args.city || "");
    const area = ctx.store.serviceAreaAllowed(ctx.business.id, city);
    if (!area.allowed) {
      return { success: false, reason: "outside_service_area", service_area: area };
    }
    return {
      success: true,
      timezone: ctx.business.timezone,
      windows: ctx.store.emergencyWindows(ctx.business.id),
      note:
        "These are same-day dispatch options only. The caller still needs to choose one. If the business requires a human confirmation, use transfer_to_owner."
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
  ctx.store.saveToolResult(toolCallId, ctx.sessionId, ctx.business.id, name, result);
  return result;
}
