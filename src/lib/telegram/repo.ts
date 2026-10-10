import "server-only";
import { and, eq, isNull, type SQL, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { bookings, callers, calls, enquiries, handoffs, staff, tasks } from "@/db/schema";
import { spokenSlot } from "../booking/slots";
import type { CriterionResult } from "../rules/facts";
import type { TelegramActionRepo } from "./actions";
import type { DispatchRepo } from "./dispatch";
import type { HandoffView } from "./templates";

export function createTelegramActionRepo(database: Db): TelegramActionRepo {
  return {
    async staffByTelegramId(telegramUserId) {
      const [row] = await database
        .select({ id: staff.id, name: staff.name, role: staff.role })
        .from(staff)
        .where(and(eq(staff.telegramUserId, telegramUserId), eq(staff.active, true)))
        .limit(1);
      return row ?? null;
    },
    async acceptHandoff(handoffId, staffId) {
      const updated = await database
        .update(handoffs)
        .set({ acceptedBy: staffId, acceptedAt: sql`now()` })
        .where(and(eq(handoffs.id, handoffId), isNull(handoffs.acceptedAt)))
        .returning({ enquiryId: handoffs.enquiryId });
      if (updated.length > 0) return { won: true, enquiryId: updated[0].enquiryId, acceptedBy: null };
      const [existing] = await database
        .select({ enquiryId: handoffs.enquiryId, name: staff.name })
        .from(handoffs)
        .leftJoin(staff, eq(staff.id, handoffs.acceptedBy))
        .where(eq(handoffs.id, handoffId))
        .limit(1);
      return { won: false, enquiryId: existing?.enquiryId ?? null, acceptedBy: existing?.name ?? null };
    },
    async completeTask(taskId, staffId) {
      const updated = await database
        .update(tasks)
        .set({ doneAt: sql`now()`, doneBy: staffId })
        .where(and(eq(tasks.id, taskId), isNull(tasks.doneAt)))
        .returning({ id: tasks.id });
      return updated.length > 0;
    },
    async recordResult(enquiryId, result) {
      const updated = await database
        .update(enquiries)
        .set({
          consultResult: result,
          consultResultAt: sql`now()`,
          flags: sql`(select array(select distinct unnest(${enquiries.flags} || array['sync_pending']::text[])))`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(enquiries.id, enquiryId), isNull(enquiries.consultResult)))
        .returning({ id: enquiries.id });
      return updated.length > 0;
    },
  };
}

// The data behind a handoff message. Shared by dispatch (unposted handoffs) and by the designer web
// actions, which rebuild a posted message to edit it the same way a Telegram button press does.
async function loadHandoffViews(database: Db, appUrl: string, where: SQL | undefined, limit: number): Promise<HandoffView[]> {
  const rows = await database
    .select({
      handoffId: handoffs.id,
      note: handoffs.note,
      enquiryId: enquiries.id,
      outcome: enquiries.outcome,
      criteria: enquiries.criteria,
      flags: enquiries.flags,
      consultType: enquiries.consultType,
      callerName: callers.name,
      phone: callers.phoneE164,
      designerName: staff.name,
      designerTelegramId: staff.telegramUserId,
    })
    .from(handoffs)
    .innerJoin(enquiries, eq(enquiries.id, handoffs.enquiryId))
    .innerJoin(callers, eq(callers.id, enquiries.callerId))
    .leftJoin(staff, eq(staff.id, enquiries.assignedDesignerId))
    .where(where)
    .limit(limit);
  const views = [];
  for (const row of rows) {
    const [booking] = await database
      .select({ startAt: bookings.startAt })
      .from(bookings)
      .where(and(eq(bookings.enquiryId, row.enquiryId), sql`${bookings.status} <> 'cancelled'`))
      .orderBy(sql`${bookings.createdAt} desc`)
      .limit(1);
    const [call] = await database.select({ id: calls.id }).from(calls).where(eq(calls.enquiryId, row.enquiryId)).orderBy(sql`${calls.createdAt} desc`).limit(1);
    views.push({
      handoffId: row.handoffId,
      enquiryId: row.enquiryId,
      outcome: row.outcome,
      callerName: row.callerName,
      phone: row.phone,
      slotLabel: booking ? spokenSlot(booking.startAt.toISOString()) : null,
      consultType: row.consultType ?? null,
      designerName: row.designerName,
      designerTelegramId: row.designerTelegramId ?? null,
      note: (row.note ?? null) as Record<string, unknown> | null,
      criteria: (Array.isArray(row.criteria) ? row.criteria : []) as CriterionResult[],
      flags: row.flags ?? [],
      callUrl: call ? `${appUrl}/dashboard/calls/${call.id}` : null,
    });
  }
  return views;
}

export async function handoffViewById(database: Db, appUrl: string, handoffId: string): Promise<HandoffView | null> {
  const [view] = await loadHandoffViews(database, appUrl, eq(handoffs.id, handoffId), 1);
  return view ?? null;
}

export function createDispatchRepo(database: Db, appUrl: string): DispatchRepo {
  return {
    pendingHandoffs: (limit) => loadHandoffViews(database, appUrl, isNull(handoffs.postedAt), limit),
    async markHandoffPosted(handoffId, chatId, messageId) {
      await database.update(handoffs).set({ chatId, messageId, postedAt: sql`now()` }).where(and(eq(handoffs.id, handoffId), isNull(handoffs.postedAt)));
    },
    async pendingTasks(limit) {
      const rows = await database
        .select({ taskId: tasks.id, kind: tasks.kind, reason: tasks.reason, payload: tasks.payload, dueAt: tasks.dueAt, callerName: callers.name, phone: callers.phoneE164 })
        .from(tasks)
        .leftJoin(enquiries, eq(enquiries.id, tasks.enquiryId))
        .leftJoin(callers, eq(callers.id, enquiries.callerId))
        // drizzle does not bracket raw sql chunks inside and(), so the OR must be bracketed here.
        .where(and(isNull(tasks.chatId), isNull(tasks.doneAt), sql`(${tasks.kind} <> 'nurture' or ${tasks.dueAt} <= now())`))
        .limit(limit);
      return rows.map((row) => {
        const payload = (row.payload ?? {}) as { phone?: string; summary?: string; call_id?: string };
        return {
          taskId: row.taskId,
          kind: row.kind,
          reason: row.reason ?? "",
          phone: row.phone ?? payload.phone ?? null,
          callerName: row.callerName ?? null,
          dueLabel: row.dueAt ? `${spokenSlot(row.dueAt.toISOString())}` : null,
          summary: payload.summary ?? null,
          callUrl: payload.call_id ? `${appUrl}/dashboard/calls/${payload.call_id}` : null,
        };
      });
    },
    async markTaskPosted(taskId, chatId, messageId) {
      await database.update(tasks).set({ chatId, messageId }).where(and(eq(tasks.id, taskId), isNull(tasks.chatId)));
    },
  };
}
