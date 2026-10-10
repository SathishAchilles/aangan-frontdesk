import { describe, expect, it } from "vitest";
import { bookSlot, getSlots } from "../../../src/lib/booking/handlers";
import type { BookingDeps, BookingEnquiry, BookingRepo } from "../../../src/lib/booking/types";
import { CalcomError, type CalcomClient } from "../../../src/lib/calendar";
import { defaultRulesConfig } from "../../../src/lib/rules/config";
import { fromIst } from "../../../src/lib/rules/time";

const NOW = fromIst(2026, 10, 13, 14, 0);
const ENQUIRY_ID = "5b0f6f63-62c5-4a51-9d0e-1a0d4c8d2b10";
const slotAt = (day: number, hour: number) => fromIst(2026, 10, day, hour).toISOString();
const SLOTS = [slotAt(14, 10), slotAt(14, 11), slotAt(16, 18), slotAt(17, 11), slotAt(19, 10)];

function setup(options: { outcome?: BookingEnquiry["outcome"]; calendar?: Partial<CalcomClient>; flags?: string[] } = {}) {
  const enquiry: BookingEnquiry = {
    id: ENQUIRY_ID,
    callerId: "caller-1",
    outcome: options.outcome ?? "QUALIFIED",
    consultType: "studio",
    facts: { locality: "Kothrud" },
    flags: options.flags ?? [],
  };
  const log = { tasks: [] as unknown[], bookings: [] as unknown[], updates: [] as unknown[], names: [] as string[], booked: [] as unknown[] };
  const repo: BookingRepo = {
    async getEnquiry(id) {
      return id === ENQUIRY_ID ? enquiry : null;
    },
    async updateEnquiry(_id, patch) {
      log.updates.push(patch);
      Object.assign(enquiry, patch);
    },
    async setCallerName(_id, name) {
      log.names.push(name);
    },
    async designersFor() {
      return [{ id: "designer-2", name: "Designer 2" }, { id: "designer-3", name: "Designer 3" }];
    },
    async insertBooking(booking) {
      log.bookings.push(booking);
    },
    async createTask(task) {
      log.tasks.push(task);
      return { id: "task-1" };
    },
  };
  const calendar: CalcomClient = {
    async availableSlots() {
      return SLOTS.map((start) => ({ start }));
    },
    async createBooking(input) {
      log.booked.push(input);
      return { uid: "cal-uid-1", start: input.startUtc, end: new Date(new Date(input.startUtc).getTime() + 3_600_000).toISOString(), status: "accepted" };
    },
    async cancelBooking() {},
    ...options.calendar,
  };
  const deps: BookingDeps = {
    repo,
    calendar,
    now: () => NOW,
    settings: async () => ({
      rules: defaultRulesConfig(),
      values: { calcom_event_types: { studio: 1, site: 2, principal: 3 }, slot_horizon_working_days: 10 },
    }),
  };
  return { deps, log, enquiry };
}

describe("get_slots", () => {
  it("offers up to three slots on different days with a spoken list", async () => {
    const { deps } = setup();
    const response = await getSlots({ enquiry_id: ENQUIRY_ID }, deps);
    const slots = response.body.slots as { id: string; label: string }[];
    expect(slots.map((slot) => slot.id)).toEqual([slotAt(14, 10), slotAt(16, 18), slotAt(17, 11)]);
    expect(response.body.say_line).toBe(
      "I can offer Wednesday 14 October at 10 am, Friday 16 October at 6 pm or Saturday 17 October at 11 am. Which works best for you?",
    );
  });

  it("applies the caller's constraints", async () => {
    const { deps } = setup();
    const response = await getSlots({ enquiry_id: ENQUIRY_ID, constraints_text: "weekdays after 6pm or weekends only" }, deps);
    expect((response.body.slots as { id: string }[]).map((slot) => slot.id)).toEqual([slotAt(16, 18), slotAt(17, 11)]);
  });

  it("hands over to a person when nothing fits", async () => {
    const { deps, log, enquiry } = setup();
    const response = await getSlots({ enquiry_id: ENQUIRY_ID, constraints_text: "Sunday only" }, deps);
    expect(response.body).toMatchObject({ ok: false, outcome: "NEEDS_HUMAN" });
    expect(response.body.say_line).toMatch(/call you back within 30 minutes to fix a time/);
    expect(enquiry.outcome).toBe("NEEDS_HUMAN");
    expect(log.tasks).toHaveLength(1);
  });

  it("refuses to offer slots for an enquiry that is not qualified", async () => {
    const { deps } = setup({ outcome: "NOT_QUALIFIED" });
    expect((await getSlots({ enquiry_id: ENQUIRY_ID }, deps)).status).toBe(409);
  });

  it("hands over when the calendar is down", async () => {
    const { deps } = setup({
      calendar: {
        async availableSlots() {
          throw new CalcomError("upstream", 503);
        },
      },
    });
    expect((await getSlots({ enquiry_id: ENQUIRY_ID }, deps)).body.outcome).toBe("NEEDS_HUMAN");
  });
});

describe("book_slot", () => {
  it("books the chosen slot with the least-busy designer and no email", async () => {
    const { deps, log } = setup();
    const response = await bookSlot({ enquiry_id: ENQUIRY_ID, slot_id: slotAt(14, 10), name: "Priya", phone: "8056203528" }, deps);
    expect(response.body).toMatchObject({ ok: true, booking_id: "cal-uid-1", designer_name: "Designer 2" });
    expect(response.body.say_line).toBe(
      "You're booked for a consultation at our studio on Wednesday 14 October at 10 am. Your designer will get in touch before then.",
    );
    expect(log.booked[0]).toMatchObject({ eventTypeId: 1, phone: "+918056203528" });
    expect(log.booked[0]).not.toHaveProperty("email");
    expect(log.bookings[0]).toMatchObject({ calcomUid: "cal-uid-1", designerId: "designer-2" });
    expect(log.names).toEqual(["Priya"]);
  });

  it("sends the caller's address for a site visit", async () => {
    const { deps, log, enquiry } = setup();
    enquiry.consultType = "site";
    await bookSlot({ enquiry_id: ENQUIRY_ID, slot_id: slotAt(14, 10), name: "Aarti", phone: "+919800000001" }, deps);
    expect(log.booked[0]).toMatchObject({ eventTypeId: 2, attendeeAddress: "Kothrud" });
  });

  it("offers the next slot when the chosen one was taken", async () => {
    const { deps } = setup({
      calendar: {
        async createBooking() {
          throw new CalcomError("User either already has booking at this time or is not available", 400);
        },
      },
    });
    const response = await bookSlot({ enquiry_id: ENQUIRY_ID, slot_id: slotAt(14, 10), name: "Priya", phone: "8056203528" }, deps);
    expect(response.body).toMatchObject({ ok: false, reason: "slot_taken" });
    expect(response.body.say_line).toMatch(/The next one I have is Wednesday 14 October at 11 am\. Shall I book that\?/);
  });

  it("retries once, then hands over to a person after a second calendar failure", async () => {
    const { deps, log, enquiry } = setup({
      calendar: {
        async createBooking() {
          throw new CalcomError("upstream timeout", 504);
        },
      },
    });
    const input = { enquiry_id: ENQUIRY_ID, slot_id: slotAt(14, 10), name: "Priya", phone: "8056203528" };
    const first = await bookSlot(input, deps);
    expect(first.body).toMatchObject({ ok: false, retry: true });
    const second = await bookSlot(input, deps);
    expect(second.body).toMatchObject({ ok: false, outcome: "NEEDS_HUMAN" });
    expect(enquiry.outcome).toBe("NEEDS_HUMAN");
    expect(log.tasks).toHaveLength(1);
  });

  it("rejects booking for an enquiry that is not qualified", async () => {
    const { deps } = setup({ outcome: "NEEDS_HUMAN" });
    const response = await bookSlot({ enquiry_id: ENQUIRY_ID, slot_id: slotAt(14, 10), name: "Priya", phone: "8056203528" }, deps);
    expect(response.status).toBe(409);
  });

  it("rejects a malformed slot id", async () => {
    const { deps } = setup();
    expect((await bookSlot({ enquiry_id: ENQUIRY_ID, slot_id: "tomorrow", name: "P", phone: "8056203528" }, deps)).status).toBe(400);
  });
});
