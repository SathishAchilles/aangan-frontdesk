import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { bookings, callers, crmLinks, enquiries } from "@/db/schema";
import type { CrmEnquiry, CrmLinkRepo } from "./crm";

export function createCrmLinkRepo(database: Db): CrmLinkRepo {
  return {
    async getLink(enquiryId) {
      const [row] = await database
        .select({ contactId: crmLinks.hubspotContactId, dealId: crmLinks.hubspotDealId })
        .from(crmLinks)
        .where(eq(crmLinks.enquiryId, enquiryId))
        .limit(1);
      return row ?? null;
    },
    async saveLink(enquiryId, link) {
      await database
        .insert(crmLinks)
        .values({ enquiryId, hubspotContactId: link.contactId, hubspotDealId: link.dealId })
        .onConflictDoUpdate({ target: crmLinks.enquiryId, set: { hubspotContactId: link.contactId, hubspotDealId: link.dealId, updatedAt: sql`now()` } });
    },
    async clearSyncFlag(enquiryId) {
      await database
        .update(enquiries)
        .set({ flags: sql`array_remove(${enquiries.flags}, 'sync_pending')` })
        .where(eq(enquiries.id, enquiryId));
    },
  };
}

// Enquiries waiting for a CRM sync, in the shape the sync needs.
export async function enquiriesToSync(database: Db, limit: number): Promise<CrmEnquiry[]> {
  const rows = await database
    .select({
      id: enquiries.id,
      outcome: enquiries.outcome,
      phone: callers.phoneE164,
      callerName: callers.name,
      facts: enquiries.facts,
      result: enquiries.consultResult,
      booked: sql<boolean>`exists (select 1 from ${bookings} b where b.enquiry_id = ${enquiries.id} and b.status <> 'cancelled')`,
    })
    .from(enquiries)
    .innerJoin(callers, eq(callers.id, enquiries.callerId))
    .where(and(sql`'sync_pending' = any(${enquiries.flags})`))
    .limit(limit);
  return rows.map((row) => {
    const facts = (row.facts ?? {}) as { locality?: string; scope_text?: string };
    return {
      id: row.id,
      outcome: row.outcome,
      phone: row.phone,
      callerName: row.callerName,
      locality: facts.locality ?? null,
      scope: facts.scope_text ?? null,
      booked: Boolean(row.booked),
      result: row.result ?? null,
    };
  });
}
