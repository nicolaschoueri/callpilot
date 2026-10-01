import Database from "better-sqlite3";
import crypto from "node:crypto";
import { DateTime } from "luxon";

export type Slot = { id: string; startIso: string; label: string };
export type LeadInput = {
  issue: string;
  urgency: "regular" | "emergency";
  city: string;
  address: string;
  phone: string;
  name: string;
  language: "en" | "fr";
};
export type AppointmentInput = LeadInput & {
  slotId: string;
  confirmedByCaller: boolean;
};

export class CallPilotStore {
  db: Database.Database;
  timezone: string;

  constructor(dbPath = process.env.CALLPILOT_DB_PATH || "callpilot.db", timezone = process.env.BUSINESS_TIMEZONE || "America/Toronto") {
    this.timezone = timezone;
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS calls (
        session_id TEXT PRIMARY KEY,
        caller_id TEXT,
        event_id TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS leads (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        issue TEXT NOT NULL,
        urgency TEXT NOT NULL,
        city TEXT NOT NULL,
        address TEXT NOT NULL,
        phone TEXT NOT NULL,
        name TEXT NOT NULL,
        language TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS appointments (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        slot_id TEXT UNIQUE NOT NULL,
        start_iso TEXT NOT NULL,
        issue TEXT NOT NULL,
        urgency TEXT NOT NULL,
        city TEXT NOT NULL,
        address TEXT NOT NULL,
        phone TEXT NOT NULL,
        name TEXT NOT NULL,
        language TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tool_runs (
        tool_call_id TEXT PRIMARY KEY,
        session_id TEXT,
        tool_name TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS webhook_events (
        event_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );
    `);
  }

  nowIso() {
    return DateTime.now().setZone(this.timezone).toISO()!;
  }

  recordWebhook(eventId: string) {
    if (!eventId) return true;
    try {
      this.db.prepare("INSERT INTO webhook_events(event_id, created_at) VALUES (?,?)").run(eventId, this.nowIso());
      return true;
    } catch {
      return false;
    }
  }

  upsertCall(sessionId: string, callerId: string | undefined, eventId: string | undefined, status: string) {
    const now = this.nowIso();
    this.db.prepare(`
      INSERT INTO calls(session_id, caller_id, event_id, status, created_at, updated_at)
      VALUES (@session_id,@caller_id,@event_id,@status,@created_at,@updated_at)
      ON CONFLICT(session_id) DO UPDATE SET
        caller_id=COALESCE(excluded.caller_id,calls.caller_id),
        event_id=COALESCE(excluded.event_id,calls.event_id),
        status=excluded.status,
        updated_at=excluded.updated_at
    `).run({
      session_id: sessionId,
      caller_id: callerId || null,
      event_id: eventId || null,
      status,
      created_at: now,
      updated_at: now
    });
  }

  setCallStatus(sessionId: string, status: string) {
    this.db.prepare("UPDATE calls SET status=?, updated_at=? WHERE session_id=?").run(status, this.nowIso(), sessionId);
  }

  saveLead(sessionId: string, input: LeadInput) {
    const id = "lead_" + crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO leads(id,session_id,issue,urgency,city,address,phone,name,language,created_at)
      VALUES (@id,@session_id,@issue,@urgency,@city,@address,@phone,@name,@language,@created_at)
    `).run({ id, session_id: sessionId, ...input, created_at: this.nowIso() });
    return { success: true, leadId: id };
  }

  availableSlots(limit = 6): Slot[] {
    const taken = new Set(
      (this.db.prepare("SELECT slot_id FROM appointments WHERE status='confirmed'").all() as {slot_id:string}[])
        .map((r) => r.slot_id)
    );
    const now = DateTime.now().setZone(this.timezone);
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
    if (!input.confirmedByCaller) return { success: false, reason: "caller_confirmation_required" };
    const slot = this.availableSlots(50).find((s) => s.id === input.slotId);
    if (!slot) return { success: false, reason: "slot_unavailable" };
    const id = "appt_" + crypto.randomUUID();
    try {
      this.db.prepare(`
        INSERT INTO appointments(
          id,session_id,slot_id,start_iso,issue,urgency,city,address,phone,name,language,status,created_at
        ) VALUES (
          @id,@session_id,@slot_id,@start_iso,@issue,@urgency,@city,@address,@phone,@name,@language,'confirmed',@created_at
        )
      `).run({
        id,
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
        created_at: this.nowIso()
      });
      return { success: true, appointmentId: id, slot };
    } catch {
      return { success: false, reason: "slot_unavailable" };
    }
  }

  emergencyWindows() {
    const now = DateTime.now().setZone(this.timezone);
    const day = now.toFormat("yyyyLLdd");
    return [
      { id: day + "-1300-1500", label: "today between 1 PM and 3 PM" },
      { id: day + "-1500-1700", label: "today between 3 PM and 5 PM" }
    ];
  }

  getToolResult(toolCallId: string) {
    const row = this.db.prepare("SELECT result_json FROM tool_runs WHERE tool_call_id=?").get(toolCallId) as
      | { result_json: string }
      | undefined;
    return row ? JSON.parse(row.result_json) : undefined;
  }

  saveToolResult(toolCallId: string, sessionId: string, toolName: string, result: unknown) {
    this.db.prepare(`
      INSERT INTO tool_runs(tool_call_id,session_id,tool_name,result_json,created_at)
      VALUES (?,?,?,?,?)
    `).run(toolCallId, sessionId, toolName, JSON.stringify(result), this.nowIso());
  }

  listAppointments() {
    return this.db.prepare("SELECT * FROM appointments ORDER BY start_iso").all();
  }

  listLeads() {
    return this.db.prepare("SELECT * FROM leads ORDER BY created_at DESC").all();
  }

  close() {
    this.db.close();
  }
}
