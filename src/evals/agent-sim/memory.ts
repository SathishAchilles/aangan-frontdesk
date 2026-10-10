// In-memory stand-ins for the database and Cal.com, so simulated calls run the real tool handlers
// without touching any shared data.
import { randomUUID } from "node:crypto";
import type { BookingRepo, Designer } from "../../lib/booking/types";
import type { CalcomClient } from "../../lib/calendar";
import { fromIst, istParts } from "../../lib/rules/time";
import type { CallerRecord, EnquiryRecord, TaskInput, ToolRepo } from "../../lib/tools/types";

type StoredEnquiry = EnquiryRecord & { consultType: string | null; flags: string[]; criteria?: unknown };

export class SimStore {
  callers = new Map<string, CallerRecord & { name: string | null }>();
  enquiries = new Map<string, StoredEnquiry>();
  tasks: TaskInput[] = [];
  bookings: { enquiryId: string; calcomUid: string; startAt: Date }[] = [];

  toolRepo(): ToolRepo {
    return {
      findCallerByPhone: async (phone) => [...this.callers.values()].find((caller) => caller.phoneE164 === phone) ?? null,
      upsertCaller: async (phone) => {
        const existing = [...this.callers.values()].find((caller) => caller.phoneE164 === phone);
        if (existing) return existing;
        const caller = { id: randomUUID(), phoneE164: phone, name: null };
        this.callers.set(caller.id, caller);
        return caller;
      },
      latestEnquiry: async (callerId, since) =>
        [...this.enquiries.values()].filter((e) => e.callerId === callerId && e.createdAt >= since).sort((a, b) => +b.createdAt - +a.createdAt)[0] ?? null,
      getEnquiry: async (id) => this.enquiries.get(id) ?? null,
      createEnquiry: async (callerId, intent) => {
        const enquiry: StoredEnquiry = { id: randomUUID(), callerId, intent, outcome: "PENDING", facts: {}, asked: [], createdAt: new Date(), consultType: null, flags: [] };
        this.enquiries.set(enquiry.id, enquiry);
        return enquiry;
      },
      saveEvaluation: async (id, patch) => {
        const enquiry = this.enquiries.get(id);
        if (!enquiry) return;
        Object.assign(enquiry, { ...patch, asked: patch.asked as EnquiryRecord["asked"], consultType: patch.consultType });
      },
      createTask: async (task) => {
        this.tasks.push(task);
        return { id: randomUUID() };
      },
    };
  }

  bookingRepo(): BookingRepo {
    return {
      getEnquiry: async (id) => {
        const e = this.enquiries.get(id);
        return e ? { id: e.id, callerId: e.callerId, outcome: e.outcome, consultType: (e.consultType as never) ?? null, facts: e.facts, flags: e.flags } : null;
      },
      updateEnquiry: async (id, patch) => {
        const e = this.enquiries.get(id);
        if (e) Object.assign(e, patch);
      },
      setCallerName: async (callerId, name) => {
        const caller = this.callers.get(callerId);
        if (caller) caller.name = name;
      },
      designersFor: async (): Promise<Designer[]> => [{ id: "designer-sim", name: "Designer 2" }],
      insertBooking: async (booking) => {
        this.bookings.push({ enquiryId: booking.enquiryId, calcomUid: booking.calcomUid, startAt: booking.startAt });
      },
      createTask: async (task) => {
        this.tasks.push(task);
        return { id: randomUUID() };
      },
    };
  }
}

// Monday to Saturday, 10:00 to 18:00 IST, every hour, for two weeks from `now`.
export function simCalendar(now: Date): CalcomClient {
  return {
    async availableSlots(_eventTypeId, startUtc, endUtc) {
      const slots: { start: string }[] = [];
      const p = istParts(now);
      for (let d = 0; d < 15; d += 1) {
        for (let hour = 10; hour < 18; hour += 1) {
          const at = fromIst(p.year, p.month, p.day + d, hour);
          if (istParts(at).weekday === "sun") continue;
          if (at.toISOString() >= startUtc && at.toISOString() <= endUtc) slots.push({ start: at.toISOString() });
        }
      }
      return slots;
    },
    async createBooking(input) {
      return { uid: `sim-${randomUUID()}`, start: input.startUtc, end: new Date(new Date(input.startUtc).getTime() + 3_600_000).toISOString(), status: "accepted" };
    },
    async cancelBooking() {},
  };
}
