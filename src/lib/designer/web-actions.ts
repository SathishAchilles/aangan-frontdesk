// Accept and Won/Lost from the designer area. The writes are the Telegram button handlers' own repo
// calls (acceptHandoff, recordResult), so the first press wins whichever side it comes from. The web
// adds what Telegram cannot know: who is signed in, and whether this lead is theirs to act on.
// After a write the posted Telegram message is edited the way a button press edits it, so the chat
// does not keep offering an Accept button for a lead that is already taken.
import "server-only";
import type postgres from "postgres";
import type { Db } from "@/db/client";
import { validUuid } from "@/lib/dashboard/schedule";
import { log } from "@/lib/log";
import { resultLine, stamp } from "@/lib/telegram/actions";
import type { TelegramClient } from "@/lib/telegram/client";
import { createTelegramActionRepo, handoffViewById } from "@/lib/telegram/repo";
import { acceptedFooter, handoffMessage, outcomeButtons } from "@/lib/telegram/templates";
import { acceptableBy, ownedBy } from "./queries";

export type WebActionDeps = { db: Db; sql: postgres.Sql; schema: string; telegram: TelegramClient | null; appUrl: string; now: () => Date };
export type Actor = { id: string; name: string };

export type AcceptOutcome = { ok: true; enquiryId: string } | { ok: false; reason: "not-allowed" } | { ok: false; reason: "taken"; acceptedBy: string | null };
export type ResultOutcome = { ok: true } | { ok: false; reason: "not-allowed" | "already-recorded" };

type PostedHandoff = { id: string; chat_id: number | null; message_id: number | null; accepted_at: Date | null; accepter: string | null };

async function postedHandoff(deps: WebActionDeps, where: { handoffId?: string; enquiryId?: string }): Promise<PostedHandoff | null> {
  const { sql, schema } = deps;
  const [row] = await sql<PostedHandoff[]>`
    select h.id, h.chat_id, h.message_id, h.accepted_at, st.name as accepter
    from ${sql(`${schema}.handoffs`)} h left join ${sql(`${schema}.staff`)} st on st.id = h.accepted_by
    where ${where.handoffId ? sql`h.id = ${where.handoffId}` : sql`h.enquiry_id = ${where.enquiryId!}`}`;
  return row ?? null;
}

// Best effort: the database row is the record, a failed edit only leaves the chat a step behind.
async function editTelegram(deps: WebActionDeps, handoff: PostedHandoff | null, build: (html: string) => { html: string; buttons?: ReturnType<typeof outcomeButtons> }) {
  if (!deps.telegram || !handoff?.chat_id || !handoff.message_id) return;
  try {
    const view = await handoffViewById(deps.db, deps.appUrl, handoff.id);
    if (!view) return;
    const next = build(handoffMessage(view).html);
    await deps.telegram.edit(handoff.chat_id, handoff.message_id, next.html, next.buttons);
  } catch (error) {
    log.warn("designer web action: telegram edit failed", { handoffId: handoff.id, error: error instanceof Error ? error.message : "unknown" });
  }
}

export async function acceptOnWeb(deps: WebActionDeps, actor: Actor, handoffIdInput: string): Promise<AcceptOutcome> {
  const handoffId = validUuid(handoffIdInput);
  if (!handoffId) return { ok: false, reason: "not-allowed" };
  const { sql, schema } = deps;
  const s = (name: string) => sql(`${schema}.${name}`);
  // Acceptable now, or already taken by someone else on a lead this designer could have had (so the
  // answer is "already accepted by ..." rather than a bare refusal).
  const [eligible] = await sql<{ id: string }[]>`
    select h.id
    from ${s("handoffs")} h join ${s("enquiries")} e on e.id = h.enquiry_id
    where h.id = ${handoffId}
      and (${acceptableBy(sql, schema, actor.id)} or (h.accepted_at is not null and (e.assigned_designer_id = ${actor.id} or e.assigned_designer_id is null)))`;
  if (!eligible) return { ok: false, reason: "not-allowed" };
  const result = await createTelegramActionRepo(deps.db).acceptHandoff(handoffId, actor.id);
  if (!result.won || !result.enquiryId) return { ok: false, reason: "taken", acceptedBy: result.acceptedBy };
  const enquiryId = result.enquiryId;
  await editTelegram(deps, await postedHandoff(deps, { handoffId }), (html) => ({ html: acceptedFooter(html, actor.name, stamp(deps.now())), buttons: outcomeButtons(enquiryId) }));
  return { ok: true, enquiryId };
}

export async function recordResultOnWeb(deps: WebActionDeps, actor: Actor, enquiryIdInput: string, result: "won" | "lost"): Promise<ResultOutcome> {
  const enquiryId = validUuid(enquiryIdInput);
  if (!enquiryId || (result !== "won" && result !== "lost")) return { ok: false, reason: "not-allowed" };
  const { sql, schema } = deps;
  const s = (name: string) => sql(`${schema}.${name}`);
  // Only the owner, and only once a consultation has taken place.
  const [eligible] = await sql<{ id: string }[]>`
    select e.id
    from ${s("enquiries")} e left join ${s("handoffs")} h on h.enquiry_id = e.id
    where e.id = ${enquiryId} and ${ownedBy(sql, actor.id)}
      and exists (select 1 from ${s("bookings")} b where b.enquiry_id = e.id and b.status <> 'cancelled' and b.start_at < ${deps.now()})`;
  if (!eligible) return { ok: false, reason: "not-allowed" };
  const saved = await createTelegramActionRepo(deps.db).recordResult(enquiryId, result, actor.id);
  if (!saved) return { ok: false, reason: "already-recorded" };
  const handoff = await postedHandoff(deps, { enquiryId });
  await editTelegram(deps, handoff, (html) => {
    const accepted = handoff?.accepted_at ? acceptedFooter(html, handoff.accepter ?? "a designer", stamp(handoff.accepted_at)) : html;
    return { html: `${accepted}\n\n${resultLine(result, actor.name)}` };
  });
  return { ok: true };
}
