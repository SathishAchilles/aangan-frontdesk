// Cal.com webhook: keeps our bookings in step when a booking is created, moved or cancelled
// (including changes made in Cal.com itself). Signature: hex HMAC-SHA256 of the raw body.
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { TaskInput } from "../tools/types";

export function verifyCalcomSignature(rawBody: string, signature: string | null, secret: string | undefined): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.trim(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export const calcomEventSchema = z.object({
  triggerEvent: z.string(),
  createdAt: z.string().optional(),
  payload: z
    .object({
      uid: z.string().optional(),
      rescheduleUid: z.string().optional().nullable(),
      fromReschedule: z.string().optional().nullable(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
      eventTypeId: z.number().optional().nullable(),
      metadata: z.record(z.string(), z.unknown()).optional().nullable(),
      cancellationReason: z.string().optional().nullable(),
    })
    .passthrough(),
});
export type CalcomEvent = z.infer<typeof calcomEventSchema>;

// Unique per delivery so a retried webhook is recognised as a duplicate.
export function calcomExternalId(event: CalcomEvent): string {
  return `${event.triggerEvent}:${event.payload.uid ?? "none"}:${event.payload.startTime ?? ""}`;
}

export type StoredBooking = { id: string; enquiryId: string; calcomUid: string; status: string; startAt: Date };

export interface BookingEventRepo {
  findBooking(calcomUid: string): Promise<StoredBooking | null>;
  updateBooking(id: string, patch: { calcomUid?: string; startAt?: Date; endAt?: Date; status: "booked" | "rescheduled" | "cancelled" }): Promise<void>;
  enquiryExists(id: string): Promise<boolean>;
  insertBooking(booking: { enquiryId: string; calcomUid: string; startAt: Date; endAt: Date; consultType: "studio" | "site" | "principal" }): Promise<void>;
  createTask(task: TaskInput): Promise<{ id: string }>;
  // Records that the designer note and CRM stage must be refreshed for this enquiry.
  markBookingChanged(enquiryId: string, change: "created" | "rescheduled" | "cancelled"): Promise<void>;
}

export type BookingEventResult = { action: "created" | "rescheduled" | "cancelled" | "ignored"; reason?: string };

export async function processCalcomEvent(
  event: CalcomEvent,
  repo: BookingEventRepo,
  eventTypeIds: Record<string, number | null>,
): Promise<BookingEventResult> {
  const { payload } = event;
  const consultType =
    (Object.entries(eventTypeIds).find(([, id]) => id === payload.eventTypeId)?.[0] as "studio" | "site" | "principal" | undefined) ??
    "studio";

  switch (event.triggerEvent) {
    case "BOOKING_CREATED": {
      if (!payload.uid || !payload.startTime || !payload.endTime) return { action: "ignored", reason: "incomplete payload" };
      if (await repo.findBooking(payload.uid)) return { action: "ignored", reason: "already stored by book_slot" };
      const enquiryId = typeof payload.metadata?.enquiry_id === "string" ? payload.metadata.enquiry_id : undefined;
      if (!enquiryId || !(await repo.enquiryExists(enquiryId))) return { action: "ignored", reason: "not booked through the front desk" };
      await repo.insertBooking({ enquiryId, calcomUid: payload.uid, startAt: new Date(payload.startTime), endAt: new Date(payload.endTime), consultType });
      await repo.markBookingChanged(enquiryId, "created");
      return { action: "created" };
    }
    case "BOOKING_RESCHEDULED": {
      const previousUid = payload.rescheduleUid ?? payload.fromReschedule ?? payload.uid;
      const booking = (previousUid && (await repo.findBooking(previousUid))) || (payload.uid && (await repo.findBooking(payload.uid)));
      if (!booking || !payload.startTime) return { action: "ignored", reason: "unknown booking" };
      await repo.updateBooking(booking.id, {
        calcomUid: payload.uid ?? booking.calcomUid,
        startAt: new Date(payload.startTime),
        endAt: payload.endTime ? new Date(payload.endTime) : undefined,
        status: "rescheduled",
      });
      await repo.markBookingChanged(booking.enquiryId, "rescheduled");
      return { action: "rescheduled" };
    }
    case "BOOKING_CANCELLED": {
      const booking = payload.uid ? await repo.findBooking(payload.uid) : null;
      if (!booking) return { action: "ignored", reason: "unknown booking" };
      if (booking.status === "cancelled") return { action: "ignored", reason: "already cancelled" };
      await repo.updateBooking(booking.id, { status: "cancelled" });
      await repo.createTask({
        enquiryId: booking.enquiryId,
        kind: "rebook",
        reason: "Consultation cancelled: call the client and rebook",
        payload: { calcom_uid: booking.calcomUid, cancellation_reason: payload.cancellationReason ?? null },
      });
      await repo.markBookingChanged(booking.enquiryId, "cancelled");
      return { action: "cancelled" };
    }
    default:
      return { action: "ignored", reason: `unhandled trigger ${event.triggerEvent}` };
  }
}
