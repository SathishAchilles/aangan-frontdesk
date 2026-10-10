import "server-only";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { bookings, callers, calls, enquiries, handoffs, staff, tasks } from "@/db/schema";
import type { FollowupRepo } from "./run";

// Claims are conditional updates: only the run whose update matches a still-empty column acts.
export function createFollowupRepo(database: Db): FollowupRepo {
  return {
    async handoffsWaiting() {
      return database
        .select({ id: handoffs.id, enquiryId: handoffs.enquiryId, postedAt: handoffs.postedAt, remindedAt: handoffs.remindedAt, escalatedAt: handoffs.escalatedAt, callerName: callers.name, designerName: staff.name })
        .from(handoffs)
        .innerJoin(enquiries, eq(enquiries.id, handoffs.enquiryId))
        .innerJoin(callers, eq(callers.id, enquiries.callerId))
        .leftJoin(staff, eq(staff.id, enquiries.assignedDesignerId))
        .where(and(isNotNull(handoffs.postedAt), isNull(handoffs.acceptedAt), isNull(handoffs.escalatedAt))) as never;
    },
    async claimHandoff(id, field, now) {
      const column = field === "remindedAt" ? handoffs.remindedAt : handoffs.escalatedAt;
      const rows = await database.update(handoffs).set({ [field]: now }).where(and(eq(handoffs.id, id), isNull(column))).returning({ id: handoffs.id });
      return rows.length > 0;
    },
    async releaseHandoff(id, field) {
      await database.update(handoffs).set({ [field]: null }).where(eq(handoffs.id, id));
    },
    async callbacksWaiting() {
      return database
        .select({
          id: tasks.id,
          kind: tasks.kind,
          dueAt: tasks.dueAt,
          escalatedAt: tasks.escalatedAt,
          reason: sql<string>`coalesce(${tasks.reason}, '')`,
          callerName: callers.name,
          // Existing-client tasks have no enquiry; their number is in the payload.
          phone: sql<string | null>`coalesce(${callers.phoneE164}, ${tasks.payload}->>'phone')`,
        })
        .from(tasks)
        .leftJoin(enquiries, eq(enquiries.id, tasks.enquiryId))
        .leftJoin(callers, eq(callers.id, enquiries.callerId))
        // Promised callbacks to new callers and to existing clients with a problem both escalate when late.
        .where(and(inArray(tasks.kind, ["callback", "urgent"]), isNull(tasks.doneAt), isNull(tasks.escalatedAt), isNotNull(tasks.dueAt)));
    },
    async claimTaskEscalation(id, now) {
      const rows = await database.update(tasks).set({ escalatedAt: now }).where(and(eq(tasks.id, id), isNull(tasks.escalatedAt))).returning({ id: tasks.id });
      return rows.length > 0;
    },
    async releaseTaskEscalation(id) {
      await database.update(tasks).set({ escalatedAt: null }).where(eq(tasks.id, id));
    },
    async consultsWaiting() {
      const rows = await database
        .select({
          enquiryId: enquiries.id,
          startAt: sql<Date>`max(${bookings.startAt})`,
          nudges: enquiries.outcomeNudges,
          lastNudgeAt: enquiries.lastNudgeAt,
          hasResult: sql<boolean>`${enquiries.consultResult} is not null`,
          callerName: callers.name,
          designerName: staff.name,
        })
        .from(enquiries)
        .innerJoin(bookings, and(eq(bookings.enquiryId, enquiries.id), sql`${bookings.status} <> 'cancelled'`))
        .innerJoin(callers, eq(callers.id, enquiries.callerId))
        .leftJoin(staff, eq(staff.id, enquiries.assignedDesignerId))
        .where(and(isNull(enquiries.consultResult), sql`${bookings.startAt} < now()`))
        .groupBy(enquiries.id, callers.name, staff.name);
      return rows.map((row) => ({ ...row, startAt: new Date(row.startAt) }));
    },
    async claimNudge(enquiryId, expectedNudges, now) {
      const rows = await database
        .update(enquiries)
        .set({ outcomeNudges: expectedNudges + 1, lastNudgeAt: now })
        .where(and(eq(enquiries.id, enquiryId), eq(enquiries.outcomeNudges, expectedNudges)))
        .returning({ id: enquiries.id });
      return rows.length > 0;
    },
    async releaseNudge(enquiryId, previous) {
      await database.update(enquiries).set({ outcomeNudges: previous.nudges, lastNudgeAt: previous.lastNudgeAt }).where(eq(enquiries.id, enquiryId));
    },
    async nurturesWaiting() {
      return database
        .select({
          enquiryId: enquiries.id,
          nurtureDueAt: enquiries.nurtureDueAt,
          hasTask: sql<boolean>`exists (select 1 from ${tasks} t where t.enquiry_id = ${enquiries.id} and t.kind = 'nurture')`,
          callerName: callers.name,
        })
        .from(enquiries)
        .innerJoin(callers, eq(callers.id, enquiries.callerId))
        .where(and(isNotNull(enquiries.nurtureDueAt), sql`${enquiries.nurtureDueAt} <= now()`));
    },
    async createNurtureTask(enquiryId, reason) {
      // One nurture task per enquiry, enforced by the insert's own condition.
      const rows = await database.execute<{ id: string }>(sql`
        insert into ${tasks} (enquiry_id, kind, reason, payload, due_at)
        select ${enquiryId}, 'nurture', ${reason}, '{}'::jsonb, now()
        where not exists (select 1 from ${tasks} t where t.enquiry_id = ${enquiryId} and t.kind = 'nurture')
        returning id`);
      return rows.length > 0;
    },
    async droppedCalls() {
      return database
        .select({
          callId: calls.id,
          enquiryId: calls.enquiryId,
          endedAt: calls.endedAt,
          callbackPlacedAt: calls.callbackPlacedAt,
          redialled: sql<boolean>`exists (select 1 from ${calls} c2 where c2.caller_id = ${calls.callerId} and c2.id <> ${calls.id} and c2.started_at > ${calls.endedAt})`,
          phone: callers.phoneE164,
          callerName: callers.name,
        })
        .from(calls)
        .leftJoin(callers, eq(callers.id, calls.callerId))
        .where(and(eq(calls.dropped, true), isNull(calls.callbackPlacedAt), sql`${calls.endedAt} > now() - interval '1 day'`));
    },
    async claimCallback(callId, now) {
      const rows = await database.update(calls).set({ callbackPlacedAt: now }).where(and(eq(calls.id, callId), isNull(calls.callbackPlacedAt))).returning({ id: calls.id });
      return rows.length > 0;
    },
    async createTask(task) {
      await database.insert(tasks).values({ enquiryId: task.enquiryId, kind: task.kind, reason: task.reason, payload: task.payload, dueAt: task.dueAt });
    },
  };
}
