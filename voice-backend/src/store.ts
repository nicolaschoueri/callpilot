import Database from "better-sqlite3";
import crypto from "node:crypto";
import { DateTime } from "luxon";

export type Trade = "hvac" | "plumbing" | "electrical" | "roofing" | "general";
export type CalendarMode = "lead_only" | "internal";

export type BusinessProfile = {
  id: string;
  name: string;
  ownerFirstName: string;
  trade: Trade;
  timezone: string;
  callpilotNumber: string;
  ownerPhone?: string;
  ownerTransferUri?: string;
  serviceAreas: string[];
  calendarMode: CalendarMode;
  active: boolean;
};

export type BusinessInput = Omit<BusinessProfile, "active"> & { active?: boolean };

export type Slot = { id: string; startIso: string; label: string };

export type LeadInput = {
  issue: string;
  urgency: "regular" | "emergency";
  city: string;
  address: string;
  phone: string;
  name: string;
  language: "en" | "fr";
  preferredDay?: string;
  preferredTime?: string;
};

export type AppointmentInput = LeadInput & {
  businessId: string;
  slotId: string;
  confirmedByCaller: boolean;
};

type BusinessRow = {
  id: string;
  name: string;
  owner_first_name: string;
  trade: Trade;
  timezone: string;
  callpilot_number: string;
  owner_phone: string | null;
  owner_transfer_uri: string | null;
  service_areas_json: string;
  calendar_mode: CalendarMode;
  active: number;
};

export function normalizePhone(value: string | undefined | null) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const plus = raw.includes("+");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return (plus ? "+" : digits.length >= 10 ? "+" : "") + digits;
}

function rowToBusiness(row: BusinessRow | undefined): BusinessProfile | undefined {
  if (!row) return undefined;
  let serviceAreas: string[] = [];
  try {
    const parsed = JSON.parse(row.service_areas_json || "[]");
    if (Array.isArray(parsed)) serviceAreas = parsed.map((v) => String(v));
  } catch {
    serviceAreas = [];
  }
  return {
    id: row.id,
    name: row.name,
    ownerFirstName: row.owner_first_name,
    trade: row.trade,
    timezone: row.timezone,
    callpilotNumber: row.callpilot_number,
    ownerPhone: row.owner_phone || undefined,
    ownerTransferUri: row.owner_transfer_uri || undefined,
    serviceAreas,
    calendarMode: row.calendar_mode,
    active: row.active === 1
  };
}

export class CallPilotStore {
  db: Database.Database;
  defaultTimezone: string;

  constructor(
    dbPath = process.env.CALLPILOT_DB_PATH || "callpilot.db",
    timezone = process.env.BUSINESS_TIMEZONE || "America/Toronto"
  ) {
    this.defaultTimezone = timezone;
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cp_businesses (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_first_name TEXT NOT NULL,
        trade TEXT NOT NULL,
        timezone TEXT NOT NULL,
        callpilot_number TEXT NOT NULL UNIQUE,
        owner_phone TEXT,
        owner_transfer_uri TEXT,
        service_areas_json TEXT NOT NULL DEFAULT '[]',
        calendar_mode TEXT NOT NULL DEFAULT 'lead_only',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cp_calls (
        session_id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL,
        caller_id TEXT,
        destination_number TEXT,
        event_id TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(business_id) REFERENCES cp_businesses(id)
      );

      CREATE TABLE IF NOT EXISTS cp_leads (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL,
        session_id TEXT,
        issue TEXT NOT NULL,
        urgency TEXT NOT NULL,
        city TEXT NOT NULL,
        address TEXT NOT NULL,
        phone TEXT NOT NULL,
        name TEXT NOT NULL,
        language TEXT NOT NULL,
        preferred_day TEXT,
        preferred_time TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(business_id) REFERENCES cp_businesses(id)
      );

      CREATE TABLE IF NOT EXISTS cp_appointments (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL,
        session_id TEXT,
        slot_id TEXT NOT NULL,
        start_iso TEXT NOT NULL,
        issue TEXT NOT NULL,
        urgency TEXT NOT NULL,
        city TEXT NOT NULL,
        address TEXT NOT NULL,
        phone TEXT NOT NULL,
        name TEXT NOT NULL,
        language TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(business_id, slot_id),
        FOREIGN KEY(business_id) REFERENCES cp_businesses(id)
      );

      CREATE TABLE IF NOT EXISTS cp_tool_runs (
        tool_call_id TEXT PRIMARY KEY,
        session_id TEXT,
        business_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(business_id) REFERENCES cp_businesses(id)
      );

      CREATE TABLE IF NOT EXISTS cp_webhook_events (
        event_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_cp_calls_business_created
        ON cp_calls(business_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cp_leads_business_created
        ON cp_leads(business_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cp_appointments_business_start
        ON cp_appointments(business_id, start_iso);
    `);
  }

  nowIso(timezone = this.defaultTimezone) {
    return DateTime.now().setZone(timezone).toISO()!;
  }

  recordWebhook(eventId: string) {
    if (!eventId) return true;
    try {
      this.db.prepare("INSERT INTO cp_webhook_events(event_id, created_at) VALUES (?,?)")
        .run(eventId, this.nowIso());
      return true;
    } catch {
      return false;
    }
  }

  upsertBusiness(input: BusinessInput) {
    const callpilotNumber = normalizePhone(input.callpilotNumber);
    if (!input.id.trim()) throw new Error("business id is required");
    if (!input.name.trim()) throw new Error("business name is required");
    if (!callpilotNumber) throw new Error("CallPilot routing number is required");

    const now = this.nowIso(input.timezone || this.defaultTimezone);
    this.db.prepare(`
      INSERT INTO cp_businesses(
        id,name,owner_first_name,trade,timezone,callpilot_number,owner_phone,
        owner_transfer_uri,service_areas_json,calendar_mode,active,created_at,updated_at
      ) VALUES (
        @id,@name,@owner_first_name,@trade,@timezone,@callpilot_number,@owner_phone,
        @owner_transfer_uri,@service_areas_json,@calendar_mode,@active,@created_at,@updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        owner_first_name=excluded.owner_first_name,
        trade=excluded.trade,
        timezone=excluded.timezone,
        callpilot_number=excluded.callpilot_number,
        owner_phone=excluded.owner_phone,
        owner_transfer_uri=excluded.owner_transfer_uri,
        service_areas_json=excluded.service_areas_json,
        calendar_mode=excluded.calendar_mode,
        active=excluded.active,
        updated_at=excluded.updated_at
    `).run({
      id: input.id.trim(),
      name: input.name.trim(),
      owner_first_name: input.ownerFirstName.trim() || "Owner",
      trade: input.trade,
      timezone: input.timezone || this.defaultTimezone,
      callpilot_number: callpilotNumber,
      owner_phone: normalizePhone(input.ownerPhone) || null,
      owner_transfer_uri:
        input.ownerTransferUri?.trim() ||
        (normalizePhone(input.ownerPhone) ? `tel:${normalizePhone(input.ownerPhone)}` : null),
      service_areas_json: JSON.stringify(input.serviceAreas || []),
      calendar_mode: input.calendarMode,
      active: input.active === false ? 0 : 1,
      created_at: now,
      updated_at: now
    });

    return this.getBusiness(input.id)!;
  }

  createBusinessIfMissing(input: BusinessInput) {
    const existing = this.getBusiness(input.id);
    return existing || this.upsertBusiness(input);
  }

  getBusiness(id: string) {
    return rowToBusiness(
      this.db.prepare("SELECT * FROM cp_businesses WHERE id=?").get(id) as BusinessRow | undefined
    );
  }

  resolveBusinessByDestination(destination: string | undefined) {
    const number = normalizePhone(destination);
    if (!number) return undefined;
    return rowToBusiness(
      this.db.prepare("SELECT * FROM cp_businesses WHERE callpilot_number=? AND active=1")
        .get(number) as BusinessRow | undefined
    );
  }

  listBusinesses() {
    return (this.db.prepare("SELECT * FROM cp_businesses ORDER BY name").all() as BusinessRow[])
      .map((row) => rowToBusiness(row)!)
      .filter(Boolean);
  }

  setBusinessActive(id: string, active: boolean) {
    this.db.prepare("UPDATE cp_businesses SET active=?, updated_at=? WHERE id=?")
      .run(active ? 1 : 0, this.nowIso(), id);
    return this.getBusiness(id);
  }

  upsertCall(
    sessionId: string,
    businessId: string,
    callerId: string | undefined,
    destinationNumber: string | undefined,
    eventId: string | undefined,
    status: string
  ) {
    const business = this.getBusiness(businessId);
    if (!business) throw new Error("Unknown business");
    const now = this.nowIso(business.timezone);
    this.db.prepare(`
      INSERT INTO cp_calls(
        session_id,business_id,caller_id,destination_number,event_id,status,created_at,updated_at
      ) VALUES (
        @session_id,@business_id,@caller_id,@destination_number,@event_id,@status,@created_at,@updated_at
      )
      ON CONFLICT(session_id) DO UPDATE SET
        caller_id=COALESCE(excluded.caller_id,cp_calls.caller_id),
        destination_number=COALESCE(excluded.destination_number,cp_calls.destination_number),
        event_id=COALESCE(excluded.event_id,cp_calls.event_id),
        status=excluded.status,
        updated_at=excluded.updated_at
    `).run({
      session_id: sessionId,
      business_id: businessId,
      caller_id: normalizePhone(callerId) || null,
      destination_number: normalizePhone(destinationNumber) || null,
      event_id: eventId || null,
      status,
      created_at: now,
      updated_at: now
    });
  }

  setCallStatus(sessionId: string, status: string) {
    this.db.prepare("UPDATE cp_calls SET status=?, updated_at=? WHERE session_id=?")
      .run(status, this.nowIso(), sessionId);
  }

  getCall(sessionId: string) {
    return this.db.prepare("SELECT * FROM cp_calls WHERE session_id=?").get(sessionId) as any;
  }

  listCalls(businessId: string) {
    return this.db.prepare(
      "SELECT * FROM cp_calls WHERE business_id=? ORDER BY created_at DESC LIMIT 200"
    ).all(businessId);
  }

  saveLead(businessId: string, sessionId: string, input: LeadInput) {
    const business = this.getBusiness(businessId);
    if (!business) return { success: false, reason: "unknown_business" };
    const id = "lead_" + crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO cp_leads(
        id,business_id,session_id,issue,urgency,city,address,phone,name,language,
        preferred_day,preferred_time,created_at
      ) VALUES (
        @id,@business_id,@session_id,@issue,@urgency,@city,@address,@phone,@name,@language,
        @preferred_day,@preferred_time,@created_at
      )
    `).run({
      id,
      business_id: businessId,
      session_id: sessionId,
      issue: input.issue,
      urgency: input.urgency,
      city: input.city,
      address: input.address,
      phone: input.phone,
      name: input.name,
      language: input.language,
      preferred_day: input.preferredDay || null,
      preferred_time: input.preferredTime || null,
      created_at: this.nowIso(business.timezone)
    });
    return { success: true, leadId: id };
  }

  serviceAreaAllowed(businessId: string, city: string) {
    const business = this.getBusiness(businessId);
    if (!business) return { allowed: false, reason: "unknown_business" };
    if (business.serviceAreas.length === 0) return { allowed: true, matched: "all" };
    const needle = city.trim().toLocaleLowerCase();
    const match = business.serviceAreas.find((area) => {
      const normalized = area.trim().toLocaleLowerCase();
      return normalized === needle || normalized.includes(needle) || needle.includes(normalized);
    });
    return match ? { allowed: true, matched: match } : { allowed: false, reason: "outside_service_area" };
  }

  availableSlots(businessId: string, limit = 6): Slot[] {
    const business = this.getBusiness(businessId);
    if (!business || business.calendarMode !== "internal") return [];

    const taken = new Set(
      (this.db.prepare(
        "SELECT slot_id FROM cp_appointments WHERE business_id=? AND status='confirmed'"
      ).all(businessId) as { slot_id: string }[]).map((r) => r.slot_id)
    );

    const now = DateTime.now().setZone(business.timezone);
    const slots: Slot[] = [];
    for (let offset = 0; offset < 21 && slots.length < limit; offset++) {
      const day = now.startOf("day").plus({ days: offset });
      const times =
        day.weekday >= 1 && day.weekday <= 5
          ? [{ hour: 10, minute: 30 }, { hour: 14, minute: 0 }]
          : day.weekday === 6
            ? [{ hour: 9, minute: 0 }]
            : [];

      for (const t of times) {
        const start = day.set({ hour: t.hour, minute: t.minute, second: 0, millisecond: 0 });
        if (start <= now.plus({ minutes: 30 })) continue;
        const id = start.toFormat("yyyyLLdd-HHmm");
        if (taken.has(id)) continue;
        slots.push({
          id,
          startIso: start.toISO()!,
          label: start.toLocaleString({
            weekday: "long",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit"
          })
        });
        if (slots.length >= limit) break;
      }
    }
    return slots;
  }

  bookAppointment(sessionId: string, input: AppointmentInput) {
    const business = this.getBusiness(input.businessId);
    if (!business) return { success: false, reason: "unknown_business" };
    if (business.calendarMode !== "internal") {
      return { success: false, reason: "calendar_not_connected" };
    }
    if (!input.confirmedByCaller) {
      return { success: false, reason: "caller_confirmation_required" };
    }

    const slot = this.availableSlots(input.businessId, 50).find((s) => s.id === input.slotId);
    if (!slot) return { success: false, reason: "slot_unavailable" };

    const id = "appt_" + crypto.randomUUID();
    try {
      this.db.prepare(`
        INSERT INTO cp_appointments(
          id,business_id,session_id,slot_id,start_iso,issue,urgency,city,address,phone,
          name,language,status,created_at
        ) VALUES (
          @id,@business_id,@session_id,@slot_id,@start_iso,@issue,@urgency,@city,@address,@phone,
          @name,@language,'confirmed',@created_at
        )
      `).run({
        id,
        business_id: input.businessId,
        session_id: sessionId,
        slot_id: input.slotId,
        start_iso: slot.startIso,
        issue: input.issue,
        urgency: input.urgency,
        city: input.city,
        address: input.address,
        phone: input.phone,
        name: input.name,
        language: input.language,
        created_at: this.nowIso(business.timezone)
      });
      return { success: true, appointmentId: id, slot };
    } catch {
      return { success: false, reason: "slot_unavailable" };
    }
  }

  emergencyWindows(businessId: string) {
    const business = this.getBusiness(businessId);
    if (!business) return [];
    const now = DateTime.now().setZone(business.timezone);
    const day = now.toFormat("yyyyLLdd");
    return [
      { id: day + "-1300-1500", label: "today between 1 PM and 3 PM" },
      { id: day + "-1500-1700", label: "today between 3 PM and 5 PM" },
      { id: day + "-first", label: "first available technician today" }
    ];
  }

  getToolResult(toolCallId: string) {
    const row = this.db.prepare("SELECT result_json FROM cp_tool_runs WHERE tool_call_id=?")
      .get(toolCallId) as { result_json: string } | undefined;
    return row ? JSON.parse(row.result_json) : undefined;
  }

  saveToolResult(
    toolCallId: string,
    sessionId: string,
    businessId: string,
    toolName: string,
    result: unknown
  ) {
    this.db.prepare(`
      INSERT INTO cp_tool_runs(tool_call_id,session_id,business_id,tool_name,result_json,created_at)
      VALUES (?,?,?,?,?,?)
    `).run(toolCallId, sessionId, businessId, toolName, JSON.stringify(result), this.nowIso());
  }

  listAppointments(businessId: string) {
    return this.db.prepare(
      "SELECT * FROM cp_appointments WHERE business_id=? ORDER BY start_iso"
    ).all(businessId);
  }

  listLeads(businessId: string) {
    return this.db.prepare(
      "SELECT * FROM cp_leads WHERE business_id=? ORDER BY created_at DESC LIMIT 500"
    ).all(businessId);
  }

  close() {
    this.db.close();
  }
}
