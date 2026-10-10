// Eval slot-compliance: real Cal.com availability, filtered by each caller phrase, must only
// offer slots inside the phrase's gold windows; and phone-only sandbox bookings must succeed.
import { pickSlots, parseSlotConstraints } from "../../lib/booking/slots";
import { createCalcomClient } from "../../lib/calendar";
import { addDays, istParts } from "../../lib/rules/time";
import { datasetVersion, loadJsonl } from "../datasets";
import type { EvalRunner } from "../registry";
import { buildReport } from "../report";
import { type ItemResult, slotConstraintSchema } from "../types";

const STUDIO_EVENT_TYPE = 7426686;
const toMinutes = (hhmm: string) => (hhmm === "23:59" ? 24 * 60 : Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)));

export const slotCompliance: EvalRunner = async ({ budget, args }) => {
  const startedAt = new Date();
  const key = process.env.CALCOM_API_KEY;
  if (!key) throw new Error("CALCOM_API_KEY is not set");
  const calendar = createCalcomClient(key);
  const gold = loadJsonl("slot-constraints.jsonl", slotConstraintSchema);
  const now = new Date();
  const available = (await calendar.availableSlots(STUDIO_EVENT_TYPE, now.toISOString(), addDays(now, 14).toISOString(), "Asia/Kolkata")).map(
    (slot) => new Date(slot.start).toISOString(),
  );

  const items: ItemResult[] = [];
  let offered = 0;
  let inside = 0;
  for (const item of gold) {
    const picked = pickSlots(available, parseSlotConstraints(item.phrase, now), 3);
    const outside = picked.filter((start) => {
      const p = istParts(new Date(start));
      const minute = p.hour * 60 + p.minute;
      return !item.allowed.some((window) => window.days.includes(p.weekday) && minute >= toMinutes(window.from) && minute < toMinutes(window.to));
    });
    offered += picked.length;
    inside += picked.length - outside.length;
    items.push({
      item_id: item.id,
      expected: item.allowed,
      actual: { offered: picked, outside },
      scores: { offered: picked.length, outside: outside.length },
      passed: outside.length === 0,
    });
  }

  // Phone-only bookings far ahead, cancelled straight away. Each sends the calendar owner an email.
  const bookings = Number(args.bookings ?? 10);
  const decemberSlots = (
    await calendar.availableSlots(STUDIO_EVENT_TYPE, "2026-12-07T00:00:00Z", "2026-12-19T00:00:00Z", "Asia/Kolkata")
  ).map((slot) => new Date(slot.start).toISOString());
  let booked = 0;
  for (let i = 0; i < bookings && i < decemberSlots.length; i += 1) {
    const start = decemberSlots[i * 3] ?? decemberSlots[i];
    try {
      const booking = await calendar.createBooking({
        eventTypeId: STUDIO_EVENT_TYPE,
        startUtc: start,
        name: `Eval booking ${i + 1}`,
        phone: `+9199997${String(i).padStart(5, "0")}`,
        timeZone: "Asia/Kolkata",
        metadata: { source: "aangan-eval-slot-compliance" },
      });
      booked += 1;
      await calendar.cancelBooking(booking.uid, "Eval booking, cancelled automatically");
      items.push({ item_id: `booking-${i + 1}`, expected: "accepted", actual: booking.status, scores: { booked: true }, passed: true });
    } catch (error) {
      items.push({ item_id: `booking-${i + 1}`, expected: "accepted", actual: String(error), scores: { booked: false }, passed: false });
    }
  }

  return buildReport({
    evalName: "slot-compliance",
    datasetVersion: datasetVersion("slot-constraints.jsonl"),
    startedAt,
    metrics: {
      phrases: gold.length,
      slots_offered: offered,
      inside_window_rate: offered ? inside / offered : 1,
      phrases_with_offers: items.filter((item) => item.item_id.startsWith("S") && Number(item.scores.offered) > 0).length,
      bookings_attempted: Math.min(bookings, decemberSlots.length),
      booking_success_rate: bookings ? booked / Math.min(bookings, decemberSlots.length) : 1,
    },
    thresholds: [
      { metric: "inside_window_rate", op: ">=", value: 0.95 },
      { metric: "booking_success_rate", op: ">=", value: 0.98 },
    ],
    items,
    costInr: budget.spentInr,
  });
};
