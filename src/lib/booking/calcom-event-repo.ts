import "server-only";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { bookings, enquiries, tasks } from "@/db/schema";
import type { BookingEventRepo } from "./calcom-webhook";

export function createBookingEventRepo(database: Db): BookingEventRepo {
  return {
    async findBooking(calcomUid) {
      const [row] = await database
        .select({ id: bookings.id, enquiryId: bookings.enquiryId, calcomUid: bookings.calcomUid, status: bookings.status, startAt: bookings.startAt })
        .from(bookings)
        .where(eq(bookings.calcomUid, calcomUid))
        .limit(1);
      return row ?? null;
    },
    async updateBooking(id, patch) {
      await database
        .update(bookings)
        .set({
          status: patch.status,
          ...(patch.calcomUid ? { calcomUid: patch.calcomUid } : {}),
          ...(patch.startAt ? { startAt: patch.startAt } : {}),
          ...(patch.endAt ? { endAt: patch.endAt } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(bookings.id, id));
    },
    async enquiryExists(id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
      const [row] = await database.select({ id: enquiries.id }).from(enquiries).where(eq(enquiries.id, id)).limit(1);
      return Boolean(row);
    },
    async insertBooking(booking) {
      await database.insert(bookings).values(booking).onConflictDoNothing({ target: bookings.calcomUid });
    },
    async createTask(task) {
      const [row] = await database
        .insert(tasks)
        .values({ enquiryId: task.enquiryId, kind: task.kind, reason: task.reason, payload: task.payload, dueAt: task.dueAt })
        .returning({ id: tasks.id });
      return row;
    },
    async markBookingChanged(enquiryId, change) {
      // The handoff and CRM sync steps pick up enquiries flagged sync_pending.
      await database
        .update(enquiries)
        .set({
          flags: sql`(select array(select distinct unnest(${enquiries.flags} || array['sync_pending', ${`booking_${change}`}]::text[])))`,
          updatedAt: sql`now()`,
        })
        .where(eq(enquiries.id, enquiryId));
    },
  };
}
