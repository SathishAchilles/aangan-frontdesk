import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { inbox } from "@/db/schema";

export type InboxSource = "vaani" | "calcom" | "telegram";

export type InboxStore = {
  // Returns the row id, or null when this (source, external id) was already received.
  insert(source: InboxSource, externalId: string, payload: unknown): Promise<number | null>;
  markProcessed(id: number): Promise<void>;
  markFailed(id: number, error: string): Promise<void>;
};

export function createInboxStore(database: Db): InboxStore {
  return {
    async insert(source, externalId, payload) {
      const [row] = await database
        .insert(inbox)
        .values({ source, externalId, payload })
        .onConflictDoNothing({ target: [inbox.source, inbox.externalId] })
        .returning({ id: inbox.id });
      return row?.id ?? null;
    },
    async markProcessed(id) {
      await database
        .update(inbox)
        .set({ processedAt: sql`now()`, attempts: sql`${inbox.attempts} + 1`, lastError: null })
        .where(eq(inbox.id, id));
    },
    async markFailed(id, error) {
      await database
        .update(inbox)
        .set({ attempts: sql`${inbox.attempts} + 1`, lastError: error.slice(0, 1000) })
        .where(and(eq(inbox.id, id)));
    },
  };
}
