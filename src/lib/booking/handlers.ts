// get_slots and book_slot: the agent offers real availability and books during the call.
// No link or message ever goes to the caller; if booking fails, a person calls back.
import { CalcomError } from "../calendar";
import { describeCallback } from "../rules/office-time";
import type { ConsultType } from "../rules/gate";
import { addDays } from "../rules/time";
import { toE164 } from "../phone";
import type { ToolResponse } from "../tools/types";
import { parseSlotConstraints, pickSlots, spokenSlot } from "./slots";
import { type BookingDeps, type BookingEnquiry, bookSlotRequest, getSlotsRequest } from "./types";

const BOOKABLE = new Set(["QUALIFIED", "QUALIFIED_WITH_NOTES"]);
const RETRY_LINE = "Sorry, I didn't catch that properly. Could you say that again?";
const FAILURE_FLAG = "booking_failed_once";

function eventTypeId(values: Record<string, unknown>, type: ConsultType): number | undefined {
  const ids = values.calcom_event_types as Record<string, number | null> | undefined;
  return ids?.[type] ?? undefined;
}

function horizonDays(values: Record<string, unknown>): number {
  const workingDays = Number(values.slot_horizon_working_days ?? 10);
  return Math.ceil((workingDays * 7) / 5);
}

function notBookable(): ToolResponse {
  return {
    status: 409,
    body: { ok: false, error: "enquiry is not qualified for booking", say_line: "I'm not able to book that just now. Someone from our team will call you back." },
  };
}

async function handToPerson(deps: BookingDeps, enquiry: BookingEnquiry, reason: string, sentence: string): Promise<ToolResponse> {
  const { rules } = await deps.settings();
  const promise = describeCallback(deps.now(), rules.office, rules.callbackWithinMin, rules.afterHoursCallbackTime);
  await deps.repo.updateEnquiry(enquiry.id, { outcome: "NEEDS_HUMAN", flags: [...new Set([...enquiry.flags, "booking_not_made"])] });
  await deps.repo.createTask({
    enquiryId: enquiry.id,
    kind: "callback",
    reason,
    payload: { consult_type: enquiry.consultType },
    dueAt: promise.at,
  });
  return { status: 200, body: { ok: false, outcome: "NEEDS_HUMAN", say_line: `${sentence} Someone from our team will call you back ${promise.words} to fix a time.` } };
}

async function offerSlots(deps: BookingDeps, type: ConsultType, constraintsText: string | undefined, exclude?: string) {
  const { values } = await deps.settings();
  const id = eventTypeId(values, type);
  if (!id) throw new Error(`No Cal.com event type configured for ${type}`);
  const now = deps.now();
  const from = new Date(now.getTime() + 60 * 60_000);
  const slots = await deps.calendar.availableSlots(id, from.toISOString(), addDays(now, horizonDays(values)).toISOString(), "Asia/Kolkata");
  const starts = slots.map((slot) => new Date(slot.start).toISOString()).filter((start) => start !== exclude);
  return pickSlots(starts, parseSlotConstraints(constraintsText, now), 3).map((start) => ({
    id: start,
    start_ist: `${new Date(new Date(start).getTime() + 330 * 60_000).toISOString().slice(0, 16)}+05:30`,
    label: spokenSlot(start),
  }));
}

export async function getSlots(input: unknown, deps: BookingDeps): Promise<ToolResponse> {
  const parsed = getSlotsRequest.safeParse(input ?? {});
  if (!parsed.success) return { status: 400, body: { ok: false, error: parsed.error.message, say_line: RETRY_LINE } };
  const enquiry = await deps.repo.getEnquiry(parsed.data.enquiry_id);
  if (!enquiry || !BOOKABLE.has(enquiry.outcome)) return notBookable();
  const type = parsed.data.consult_type ?? enquiry.consultType ?? "studio";

  let slots;
  try {
    slots = await offerSlots(deps, type, parsed.data.constraints_text);
  } catch (error) {
    if (error instanceof CalcomError || (error instanceof Error && error.name === "TimeoutError")) {
      return handToPerson(deps, enquiry, "Calendar unavailable while booking", "I'm having trouble reaching our calendar right now.");
    }
    throw error;
  }
  if (slots.length === 0) {
    return handToPerson(deps, enquiry, "No consultation slot fits the caller's availability", "I couldn't find a time that suits you in the next two weeks.");
  }
  const spoken = slots.map((slot) => slot.label);
  const list = spoken.length === 1 ? spoken[0] : `${spoken.slice(0, -1).join(", ")} or ${spoken.at(-1)}`;
  return { status: 200, body: { ok: true, consult_type: type, slots, say_line: `I can offer ${list}. Which works best for you?` } };
}

function isSlotTaken(error: CalcomError): boolean {
  return error.status === 409 || /already|not available|no available|taken|booked/i.test(error.message);
}

export async function bookSlot(input: unknown, deps: BookingDeps): Promise<ToolResponse> {
  const parsed = bookSlotRequest.safeParse(input ?? {});
  if (!parsed.success) return { status: 400, body: { ok: false, error: parsed.error.message, say_line: RETRY_LINE } };
  const phone = toE164(parsed.data.phone);
  if (!phone) return { status: 400, body: { ok: false, error: "invalid phone", say_line: "Could you tell me the best number to reach you on?" } };
  const enquiry = await deps.repo.getEnquiry(parsed.data.enquiry_id);
  if (!enquiry || !BOOKABLE.has(enquiry.outcome)) return notBookable();

  const type = enquiry.consultType ?? "studio";
  const { values } = await deps.settings();
  const id = eventTypeId(values, type);
  if (!id) throw new Error(`No Cal.com event type configured for ${type}`);
  const [designer] = await deps.repo.designersFor(type, deps.now());
  const address = type === "studio" ? undefined : (parsed.data.address ?? enquiry.facts.locality);

  try {
    const booking = await deps.calendar.createBooking({
      eventTypeId: id,
      startUtc: new Date(parsed.data.slot_id).toISOString(),
      name: parsed.data.name,
      phone,
      timeZone: "Asia/Kolkata",
      attendeeAddress: address,
      metadata: { enquiry_id: enquiry.id, ...(designer ? { designer: designer.name } : {}) },
    });
    await deps.repo.insertBooking({
      enquiryId: enquiry.id,
      calcomUid: booking.uid,
      consultType: type,
      startAt: new Date(booking.start),
      endAt: new Date(booking.end),
      designerId: designer?.id ?? null,
    });
    await deps.repo.setCallerName(enquiry.callerId, parsed.data.name);
    await deps.repo.updateEnquiry(enquiry.id, {
      assignedDesignerId: designer?.id,
      flags: enquiry.flags.filter((flag) => flag !== FAILURE_FLAG),
    });
    const what = type === "studio" ? "a consultation at our studio" : type === "principal" ? "a site visit with our principal designer" : "a site visit";
    return {
      status: 200,
      body: {
        ok: true,
        booking_id: booking.uid,
        consult_type: type,
        designer_name: designer?.name ?? null,
        say_line: `You're booked for ${what} on ${spokenSlot(booking.start)}. Your designer will get in touch before then.`,
      },
    };
  } catch (error) {
    if (error instanceof CalcomError && isSlotTaken(error)) {
      const [alternative] = await offerSlots(deps, type, undefined, new Date(parsed.data.slot_id).toISOString()).catch(() => []);
      if (!alternative) return handToPerson(deps, enquiry, "Chosen slot was taken and no other slot was found", "That time has just been taken.");
      return {
        status: 200,
        body: { ok: false, reason: "slot_taken", alternative, say_line: `That time has just been taken. The next one I have is ${alternative.label}. Shall I book that?` },
      };
    }
    if (error instanceof CalcomError || (error instanceof Error && error.name === "TimeoutError")) {
      if (!enquiry.flags.includes(FAILURE_FLAG)) {
        await deps.repo.updateEnquiry(enquiry.id, { flags: [...enquiry.flags, FAILURE_FLAG] });
        return { status: 200, body: { ok: false, retry: true, say_line: "One moment while I try that again." } };
      }
      return handToPerson(deps, enquiry, "Calendar did not respond twice while booking", "I'm having trouble reaching our calendar right now.");
    }
    throw error;
  }
}
