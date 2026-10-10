import "server-only";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { callers, calls, costLines, enquiries, handoffs, tasks } from "@/db/schema";
import type { CallRow, LinkedEnquiry, PipelineRepo } from "./vaani-events";

const callColumns = {
  id: calls.id,
  vaaniCallId: calls.vaaniCallId,
  callerId: calls.callerId,
  enquiryId: calls.enquiryId,
  startedAt: calls.startedAt,
  durationS: calls.durationS,
};

export function createPipelineRepo(database: Db): PipelineRepo {
  return {
    async upsertCall(vaaniCallId, patch): Promise<CallRow> {
      const values = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
      const [row] = await database
        .insert(calls)
        .values({ vaaniCallId, ...values })
        .onConflictDoUpdate({ target: calls.vaaniCallId, set: Object.keys(values).length > 0 ? values : { vaaniCallId } })
        .returning(callColumns);
      return row;
    },

    async upsertCaller(phoneE164) {
      const [row] = await database
        .insert(callers)
        .values({ phoneE164 })
        .onConflictDoUpdate({ target: callers.phoneE164, set: { lastSeenAt: sql`now()` } })
        .returning({ id: callers.id });
      return row.id;
    },

    async findEnquiryForCall(callerId, since): Promise<LinkedEnquiry | null> {
      const [row] = await database
        .select()
        .from(enquiries)
        .where(and(eq(enquiries.callerId, callerId), gte(enquiries.updatedAt, since)))
        .orderBy(desc(enquiries.updatedAt))
        .limit(1);
      if (!row) return null;
      return {
        id: row.id,
        outcome: row.outcome,
        flags: row.flags ?? [],
        facts: (row.facts ?? {}) as Record<string, unknown>,
        criteria: row.criteria,
        consultType: row.consultType ?? null,
      };
    },

    async hasCostLines(callId, kind) {
      const [row] = await database
        .select({ id: costLines.id })
        .from(costLines)
        .where(and(eq(costLines.callId, callId), eq(costLines.kind, kind as never)))
        .limit(1);
      return Boolean(row);
    },

    async addCostLine(line) {
      await database.insert(costLines).values({
        callId: line.callId,
        enquiryId: line.enquiryId,
        kind: line.kind,
        qty: line.qty,
        unitPriceInr: line.unitPriceInr,
        amountInr: Math.round(line.qty * line.unitPriceInr * 10_000) / 10_000,
      });
    },

    async hasOpenTask(enquiryId, kind, callId) {
      const conditions = [eq(tasks.kind, kind), isNull(tasks.doneAt)];
      if (enquiryId) conditions.push(eq(tasks.enquiryId, enquiryId));
      if (callId) conditions.push(sql`${tasks.payload}->>'call_id' = ${callId}`);
      const [row] = await database.select({ id: tasks.id }).from(tasks).where(and(...conditions)).limit(1);
      return Boolean(row);
    },

    async createTask(task) {
      const [row] = await database
        .insert(tasks)
        .values({ enquiryId: task.enquiryId, kind: task.kind, reason: task.reason, payload: task.payload, dueAt: task.dueAt })
        .returning({ id: tasks.id });
      return row;
    },

    async ensureHandoff(enquiryId, note) {
      const inserted = await database
        .insert(handoffs)
        .values({ enquiryId, note })
        .onConflictDoNothing({ target: handoffs.enquiryId })
        .returning({ id: handoffs.id });
      if (inserted.length > 0) return "created";
      if (note) await database.update(handoffs).set({ note }).where(and(eq(handoffs.enquiryId, enquiryId), isNull(handoffs.postedAt)));
      return "exists";
    },

    async handoffHasNote(enquiryId) {
      const [row] = await database
        .select({ id: handoffs.id })
        .from(handoffs)
        .where(and(eq(handoffs.enquiryId, enquiryId), sql`${handoffs.note} is not null`))
        .limit(1);
      return Boolean(row);
    },

    async updateEnquiry(id, patch) {
      await database
        .update(enquiries)
        .set({ ...(patch.flags ? { flags: patch.flags } : {}), ...(patch.nurtureDueAt ? { nurtureDueAt: patch.nurtureDueAt } : {}), updatedAt: sql`now()` })
        .where(eq(enquiries.id, id));
    },
  };
}
