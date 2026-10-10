import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { callers, enquiries, tasks } from "@/db/schema";
import type { CallerRecord, EnquiryRecord, ToolRepo } from "./types";

function toEnquiry(row: typeof enquiries.$inferSelect): EnquiryRecord {
  return {
    id: row.id,
    callerId: row.callerId,
    intent: row.intent,
    outcome: row.outcome,
    facts: (row.facts ?? {}) as EnquiryRecord["facts"],
    asked: (row.asked ?? []) as EnquiryRecord["asked"],
    createdAt: row.createdAt,
  };
}

export function createToolRepo(database: Db): ToolRepo {
  return {
    async findCallerByPhone(phoneE164) {
      const [row] = await database
        .select({ id: callers.id, phoneE164: callers.phoneE164, name: callers.name })
        .from(callers)
        .where(eq(callers.phoneE164, phoneE164))
        .limit(1);
      return row ?? null;
    },

    async upsertCaller(phoneE164): Promise<CallerRecord> {
      const [row] = await database
        .insert(callers)
        .values({ phoneE164 })
        .onConflictDoUpdate({ target: callers.phoneE164, set: { lastSeenAt: sql`now()` } })
        .returning({ id: callers.id, phoneE164: callers.phoneE164, name: callers.name });
      return row;
    },

    async latestEnquiry(callerId, since) {
      const [row] = await database
        .select()
        .from(enquiries)
        .where(and(eq(enquiries.callerId, callerId), gte(enquiries.createdAt, since)))
        .orderBy(desc(enquiries.createdAt))
        .limit(1);
      return row ? toEnquiry(row) : null;
    },

    async getEnquiry(id) {
      const [row] = await database.select().from(enquiries).where(eq(enquiries.id, id)).limit(1);
      return row ? toEnquiry(row) : null;
    },

    async createEnquiry(callerId, intent) {
      const [row] = await database.insert(enquiries).values({ callerId, intent }).returning();
      return toEnquiry(row);
    },

    async saveEvaluation(id, patch) {
      await database
        .update(enquiries)
        .set({
          intent: patch.intent,
          outcome: patch.outcome,
          facts: patch.facts,
          asked: patch.asked,
          criteria: patch.criteria,
          flags: patch.flags,
          consultType: patch.consultType as typeof enquiries.$inferInsert.consultType,
          settingsVersion: patch.settingsVersion,
          updatedAt: sql`now()`,
        })
        .where(eq(enquiries.id, id));
    },

    async createTask(task) {
      const [row] = await database
        .insert(tasks)
        .values({
          enquiryId: task.enquiryId,
          kind: task.kind,
          reason: task.reason,
          payload: task.payload,
          dueAt: task.dueAt,
        })
        .returning({ id: tasks.id });
      return row;
    },
  };
}
