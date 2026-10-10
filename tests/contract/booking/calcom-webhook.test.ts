import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type BookingEventRepo,
  calcomEventSchema,
  calcomExternalId,
  processCalcomEvent,
  type StoredBooking,
  verifyCalcomSignature,
} from "../../../src/lib/booking/calcom-webhook";

const SECRET = "whsec-test";
const ENQUIRY = "5b0f6f63-62c5-4a51-9d0e-1a0d4c8d2b10";
const EVENT_TYPES = { studio: 7426686, site: 7426690, principal: 7426691 };
const fixture = (name: string) => readFileSync(join(__dirname, "../fixtures/calcom", name), "utf8");
const event = (name: string) => calcomEventSchema.parse(JSON.parse(fixture(name)));

function fakeRepo(initial: StoredBooking[] = []) {
  const bookings = [...initial];
  const log = { tasks: [] as unknown[], changes: [] as string[], inserted: [] as unknown[] };
  const repo: BookingEventRepo = {
    async findBooking(uid) {
      return bookings.find((booking) => booking.calcomUid === uid) ?? null;
    },
    async updateBooking(id, patch) {
      const booking = bookings.find((row) => row.id === id)!;
      Object.assign(booking, { status: patch.status, ...(patch.calcomUid ? { calcomUid: patch.calcomUid } : {}), ...(patch.startAt ? { startAt: patch.startAt } : {}) });
    },
    async enquiryExists(id) {
      return id === ENQUIRY;
    },
    async insertBooking(booking) {
      log.inserted.push(booking);
      bookings.push({ id: "b-new", enquiryId: booking.enquiryId, calcomUid: booking.calcomUid, status: "booked", startAt: booking.startAt });
    },
    async createTask(task) {
      log.tasks.push(task);
      return { id: "t1" };
    },
    async markBookingChanged(enquiryId, change) {
      log.changes.push(`${enquiryId}:${change}`);
    },
  };
  return { repo, bookings, log };
}

const stored = (): StoredBooking => ({ id: "b1", enquiryId: ENQUIRY, calcomUid: "cal-uid-created-1", status: "booked", startAt: new Date("2026-10-14T04:30:00Z") });

describe("verifyCalcomSignature", () => {
  const body = fixture("booking-created.json");
  const good = createHmac("sha256", SECRET).update(body).digest("hex");

  it("accepts the HMAC of the raw body", () => expect(verifyCalcomSignature(body, good, SECRET)).toBe(true));
  it("rejects a wrong signature", () => expect(verifyCalcomSignature(body, "0".repeat(64), SECRET)).toBe(false));
  it("rejects a tampered body", () => expect(verifyCalcomSignature(`${body} `, good, SECRET)).toBe(false));
  it("rejects a missing header or secret", () => {
    expect(verifyCalcomSignature(body, null, SECRET)).toBe(false);
    expect(verifyCalcomSignature(body, good, undefined)).toBe(false);
  });
});

describe("processCalcomEvent", () => {
  it("ignores a created event already stored by book_slot", async () => {
    const { repo, log } = fakeRepo([stored()]);
    expect(await processCalcomEvent(event("booking-created.json"), repo, EVENT_TYPES)).toMatchObject({ action: "ignored" });
    expect(log.inserted).toHaveLength(0);
  });

  it("stores a created event for one of our enquiries that we had not seen", async () => {
    const { repo, log } = fakeRepo();
    expect(await processCalcomEvent(event("booking-created.json"), repo, EVENT_TYPES)).toEqual({ action: "created" });
    expect(log.inserted[0]).toMatchObject({ enquiryId: ENQUIRY, calcomUid: "cal-uid-created-1", consultType: "studio" });
  });

  it("ignores bookings made outside the front desk", async () => {
    const { repo } = fakeRepo();
    const outside = calcomEventSchema.parse({ ...JSON.parse(fixture("booking-created.json")), payload: { ...JSON.parse(fixture("booking-created.json")).payload, metadata: {} } });
    expect((await processCalcomEvent(outside, repo, EVENT_TYPES)).action).toBe("ignored");
  });

  it("moves a rescheduled booking to its new uid and time", async () => {
    const { repo, bookings, log } = fakeRepo([stored()]);
    expect(await processCalcomEvent(event("booking-rescheduled.json"), repo, EVENT_TYPES)).toEqual({ action: "rescheduled" });
    expect(bookings[0]).toMatchObject({ calcomUid: "cal-uid-rescheduled-2", status: "rescheduled" });
    expect(bookings[0].startAt.toISOString()).toBe("2026-10-16T10:30:00.000Z");
    expect(log.changes).toEqual([`${ENQUIRY}:rescheduled`]);
  });

  it("cancels the booking and creates a rebook task", async () => {
    const { repo, bookings, log } = fakeRepo([stored()]);
    expect(await processCalcomEvent(event("booking-cancelled.json"), repo, EVENT_TYPES)).toEqual({ action: "cancelled" });
    expect(bookings[0].status).toBe("cancelled");
    expect(log.tasks[0]).toMatchObject({ kind: "rebook", payload: { cancellation_reason: "Travelling that week" } });
  });

  it("does nothing for a second cancellation of the same booking", async () => {
    const { repo, log } = fakeRepo([{ ...stored(), status: "cancelled" }]);
    expect((await processCalcomEvent(event("booking-cancelled.json"), repo, EVENT_TYPES)).action).toBe("ignored");
    expect(log.tasks).toHaveLength(0);
  });

  it("gives a retried delivery the same external id", () => {
    expect(calcomExternalId(event("booking-cancelled.json"))).toBe(calcomExternalId(event("booking-cancelled.json")));
    expect(calcomExternalId(event("booking-cancelled.json"))).not.toBe(calcomExternalId(event("booking-created.json")));
  });
});
