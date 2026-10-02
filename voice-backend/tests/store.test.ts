import { afterEach, describe, expect, it } from "vitest";
import { CallPilotStore } from "../src/store.js";

const stores: CallPilotStore[] = [];

function makeStore() {
  const store = new CallPilotStore(":memory:", "America/Toronto");
  stores.push(store);
  return store;
}

function addBusiness(
  store: CallPilotStore,
  id: string,
  number: string,
  calendarMode: "internal" | "lead_only" = "internal"
) {
  return store.upsertBusiness({
    id,
    name: id === "biz-a" ? "West Island HVAC" : "West Island Plumbing",
    ownerFirstName: "Nick",
    trade: id === "biz-a" ? "hvac" : "plumbing",
    timezone: "America/Toronto",
    callpilotNumber: number,
    ownerPhone: "+15145550001",
    serviceAreas: ["Kirkland", "Pointe-Claire", "Beaconsfield"],
    calendarMode,
    active: true
  });
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

describe("multi-business routing", () => {
  it("resolves the correct business by its hidden CallPilot number", () => {
    const store = makeStore();
    addBusiness(store, "biz-a", "+14385550142");
    addBusiness(store, "biz-b", "+14385550143");

    expect(store.resolveBusinessByDestination("+1 (438) 555-0143")?.id).toBe(
      "biz-b"
    );
    expect(store.resolveBusinessByDestination("+14385550199")).toBeUndefined();
  });

  it("checks each business service area independently", () => {
    const store = makeStore();
    addBusiness(store, "biz-a", "+14385550142");

    expect(store.serviceAreaAllowed("biz-a", "Kirkland").allowed).toBe(true);
    expect(store.serviceAreaAllowed("biz-a", "Laval").allowed).toBe(false);
  });
});

describe("booking safeguards", () => {
  it("requires explicit caller confirmation", () => {
    const store = makeStore();
    addBusiness(store, "biz-a", "+14385550142");
    const slot = store.availableSlots("biz-a", 1)[0];
    expect(slot).toBeTruthy();

    const result = store.bookAppointment("session-a", {
      ...lead,
      businessId: "biz-a",
      slotId: slot.id,
      confirmedByCaller: false
    });

    expect(result).toEqual({
      success: false,
      reason: "caller_confirmation_required"
    });
    expect(store.listAppointments("biz-a")).toHaveLength(0);
  });

  it("prevents duplicate bookings inside one business", () => {
    const store = makeStore();
    addBusiness(store, "biz-a", "+14385550142");
    const slot = store.availableSlots("biz-a", 1)[0];

    const first = store.bookAppointment("session-a", {
      ...lead,
      businessId: "biz-a",
      slotId: slot.id,
      confirmedByCaller: true
    });
    expect(first.success).toBe(true);

    const second = store.bookAppointment("session-b", {
      ...lead,
      businessId: "biz-a",
      name: "Second Customer",
      slotId: slot.id,
      confirmedByCaller: true
    });
    expect(second).toEqual({ success: false, reason: "slot_unavailable" });
    expect(store.listAppointments("biz-a")).toHaveLength(1);
  });

  it("allows the same clock slot for two different businesses", () => {
    const store = makeStore();
    addBusiness(store, "biz-a", "+14385550142");
    addBusiness(store, "biz-b", "+14385550143");
    const slotA = store.availableSlots("biz-a", 1)[0];
    const slotB = store.availableSlots("biz-b", 1)[0];
    expect(slotA.id).toBe(slotB.id);

    expect(
      store.bookAppointment("session-a", {
        ...lead,
        businessId: "biz-a",
        slotId: slotA.id,
        confirmedByCaller: true
      }).success
    ).toBe(true);

    expect(
      store.bookAppointment("session-b", {
        ...lead,
        businessId: "biz-b",
        issue: "Plumbing leak",
        slotId: slotB.id,
        confirmedByCaller: true
      }).success
    ).toBe(true);
  });

  it("does not invent availability when a business has no connected calendar", () => {
    const store = makeStore();
    addBusiness(store, "biz-a", "+14385550142", "lead_only");

    expect(store.availableSlots("biz-a", 5)).toEqual([]);
    expect(
      store.bookAppointment("session-a", {
        ...lead,
        businessId: "biz-a",
        slotId: "fake-slot",
        confirmedByCaller: true
      })
    ).toEqual({ success: false, reason: "calendar_not_connected" });
  });
});

describe("idempotency", () => {
  it("stores one tool result for an idempotency key", () => {
    const store = makeStore();
    addBusiness(store, "biz-a", "+14385550142");

    store.saveToolResult(
      "tool-123",
      "session-a",
      "biz-a",
      "check_availability",
      { success: true, value: 1 }
    );

    expect(store.getToolResult("tool-123")).toEqual({
      success: true,
      value: 1
    });

    expect(() =>
      store.saveToolResult(
        "tool-123",
        "session-a",
        "biz-a",
        "check_availability",
        { success: true, value: 2 }
      )
    ).toThrow();
  });
});
