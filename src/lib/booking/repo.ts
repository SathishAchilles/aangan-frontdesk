import "server-only";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { bookings, callers, enquiries, staff, tasks } from "@/db/schema";
import type { BookingEnquiry, BookingRepo, Designer } from "./types";

export function createBookingRepo(database: Db): BookingRepo {
  return {
    async getEnquiry(id) {
      const [row] = await database.select().from(enquiries).where(eq(enquiries.id, id)).limit(1);
      if (!row) return null;
      return {
        id: row.id,
        callerId: row.callerId,
        outcome: row.outcome,
        consultType: row.consultType ?? null,
        facts: (row.facts ?? {}) as BookingEnquiry["facts"],
        flags: row.flags ?? [],
      };
    },

    async updateEnquiry(id, patch) {
      await database
        .update(enquiries)
        .set({
          ...(patch.outcome ? { outcome: patch.outcome } : {}),
          ...(patch.flags ? { flags: patch.flags } : {}),
          ...(patch.assignedDesignerId ? { assignedDesignerId: patch.assignedDesignerId } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(enquiries.id, id));
    },

    async setCallerName(callerId, name) {
      await database.update(callers).set({ name }).where(eq(callers.id, callerId));
    },

    async designersFor(consultType, now): Promise<Designer[]> {
      const rows = await database.execute<{ id: string; name: string }>(sql`
        select s.id, s.name
        from ${staff} s
        left join ${bookings} b on b.designer_id = s.id and b.status <> 'cancelled'
        where s.role = 'designer' and s.active and ${consultType} = any(s.consult_types)
        group by s.id, s.name
        order by count(b.id) filter (where b.start_at > ${now.toISOString()}) asc,
                 max(b.created_at) asc nulls first,
                 s.name asc`);
      return rows.map((row) => ({ id: row.id, name: row.name }));
    },

    async insertBooking(booking) {
      await database
        .insert(bookings)
        .values(booking)
        .onConflictDoNothing({ target: bookings.calcomUid });
    },

    async createTask(task) {
      const [row] = await database
        .insert(tasks)
        .values({ enquiryId: task.enquiryId, kind: task.kind, reason: task.reason, payload: task.payload, dueAt: task.dueAt })
        .returning({ id: tasks.id });
      return row;
    },
  };
}
