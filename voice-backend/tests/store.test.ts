import { describe, expect, it, afterEach } from "vitest";
import { CallPilotStore } from "../src/store.js";

const stores: CallPilotStore[] = [];
function makeStore() {
  const store = new CallPilotStore(":memory:", "America/Toronto");
  stores.push(store);
  return store;
}

afterEach(() => {
  while (stores.length) stores.pop()!.close();
});

const lead = {
  issue: "Furnace stopped working",
  urgency: "regular" as const,
  city: "Kirkland",
  address: "123 Main Street",
  phone: "514-555-0123",
  name: "Test Customer",
  language: "en" as const
};

describe("booking safeguards", () => {
  it("requires explicit caller confirmation", () => {
    const store = makeStore();
    const slot = store.availableSlots(1)[0];
    expect(slot).toBeTruthy();

    const result = store.bookAppointment("session-a", {
      ...lead,
      slotId: slot.id,
      confirmedByCaller: false
    });

    expect(result).toEqual({ success: false, reason: "caller_confirmation_required" });
    expect(store.listAppointments()).toHaveLength(0);
  });

  it("prevents two bookings from taking the same slot", () => {
    const store = makeStore();
    const slot = store.availableSlots(1)[0];

    const first = store.bookAppointment("session-a", {
      ...lead,
      slotId: slot.id,
      confirmedByCaller: true
    });
    expect(first.success).toBe(true);

    const second = store.bookAppointment("session-b", {
      ...lead,
      name: "Second Customer",
      slotId: slot.id,
      confirmedByCaller: true
    });
    expect(second).toEqual({ success: false, reason: "slot_unavailable" });
    expect(store.listAppointments()).toHaveLength(1);
  });

  it("stores one tool result for an idempotency key", () => {
    const store = makeStore();
    store.saveToolResult("tool-123", "session-a", "check_availability", { success: true, value: 1 });
    expect(store.getToolResult("tool-123")).toEqual({ success: true, value: 1 });
    expect(() =>
      store.saveToolResult("tool-123", "session-a", "check_availability", { success: true, value: 2 })
    ).toThrow();
  });
});
