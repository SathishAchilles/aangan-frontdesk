// What needs a person right now, and how today is going, for the top of the Overview page.
// Every time comparison uses the `now` passed in (never SQL now()), so a fixed clock gives a fixed answer.
import type postgres from "postgres";
import { maskPhone } from "../phone";
import { officeMinutesBetween, type OfficeConfig } from "../rules/office-time";

export type AttentionKind =
  | "handoff_escalated"
  | "handoff_overdue"
  | "callback_overdue"
  | "complaint"
  | "safety_flag"
  | "handoff_waiting"
  | "callback_due"
  | "consult_today"
  | "consult_tomorrow";

// Most urgent first. Within a kind, the oldest (or soonest) comes first.
export const ATTENTION_ORDER: AttentionKind[] = [
  "handoff_escalated",
  "handoff_overdue",
  "callback_overdue",
  "complaint",
  "safety_flag",
  "handoff_waiting",
  "callback_due",
  "consult_today",
  "consult_tomorrow",
];

export type AttentionItem = {
  id: string;
  kind: AttentionKind;
  tone: "danger" | "warn" | "info";
  title: string;
  detail: string;
  // The time the item is about: when the handoff was posted, the task is due, the call started or the consultation starts.
  at: Date;
  // Wall-clock minutes a handoff has waited, or minutes a task is overdue (negative: due in that many minutes).
  minutes: number | null;
  callId: string | null;
};

export type AttentionSettings = { acceptEscalateMin: number; office: OfficeConfig };

export type Today = { calls: number; qualified: number; booked: number };

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const SOON_MS = 2 * 60 * 60_000;
const SAFETY_WINDOW_MS = 7 * DAY_MS;

// Midnight IST at the start of the IST day containing `now`.
export function istDayStart(now: Date): Date {
  const shifted = now.getTime() + IST_OFFSET_MS;
  return new Date(shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS) - IST_OFFSET_MS);
}

const minutesBetween = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / 60_000);
const who = (name: string | null, phone: string | null) => name ?? (phone ? maskPhone(phone) : "Unknown caller");
const CONSULT_LABEL: Record<string, string> = { studio: "Studio consultation", site: "Site visit", principal: "Principal visit" };

// Escalations older than this are stale (the lead has long gone cold) and would crowd out current items.
export const ESCALATION_WINDOW_DAYS = 14;

export async function attention(sql: postgres.Sql, schema: string, now: Date, settings: AttentionSettings): Promise<AttentionItem[]> {
  const s = (table: string) => sql(`${schema}.${table}`);
  const items: AttentionItem[] = [];

  // Handoffs posted to designers and not yet accepted. Escalated ones are their own group.
  const handoffs = await sql<{ id: string; posted_at: Date; escalated_at: Date | null; caller: string | null; phone: string | null; designer: string | null; call_id: string | null }[]>`
    select h.id, h.posted_at, h.escalated_at, ca.name as caller, ca.phone_e164 as phone, st.name as designer, lc.id as call_id
    from ${s("handoffs")} h
    join ${s("enquiries")} e on e.id = h.enquiry_id
    left join ${s("callers")} ca on ca.id = e.caller_id
    left join ${s("staff")} st on st.id = e.assigned_designer_id
    left join lateral (select c.id from ${s("calls")} c where c.enquiry_id = e.id order by c.created_at desc limit 1) lc on true
    where h.posted_at is not null and h.posted_at <= ${now} and h.accepted_at is null
      and (h.escalated_at is null or h.posted_at > ${new Date(now.getTime() - ESCALATION_WINDOW_DAYS * 86_400_000)})`;
  for (const row of handoffs) {
    const waited = minutesBetween(row.posted_at, now);
    const designer = row.designer ? `for ${row.designer}` : "unassigned";
    if (row.escalated_at) {
      items.push({ id: row.id, kind: "handoff_escalated", tone: "danger", title: `Escalated handoff: ${who(row.caller, row.phone)}`, detail: `Still not accepted, ${designer}`, at: row.posted_at, minutes: waited, callId: row.call_id });
    } else {
      // Same clock as the follow-ups job: only office minutes count towards the escalation limit.
      const overdue = officeMinutesBetween(row.posted_at, now, settings.office) >= settings.acceptEscalateMin;
      items.push({
        id: row.id,
        kind: overdue ? "handoff_overdue" : "handoff_waiting",
        tone: overdue ? "danger" : "warn",
        title: `Handoff waiting: ${who(row.caller, row.phone)}`,
        detail: overdue ? `Past the ${settings.acceptEscalateMin} min accept limit, ${designer}` : `Not accepted yet, ${designer}`,
        at: row.posted_at,
        minutes: waited,
        callId: row.call_id,
      });
    }
  }

  // Callbacks not done that are overdue or due within two hours.
  const callbacks = await sql<{ id: string; due_at: Date; reason: string | null; caller: string | null; phone: string | null; payload_phone: string | null; call_id: string | null }[]>`
    select t.id, t.due_at, t.reason, ca.name as caller, ca.phone_e164 as phone, t.payload->>'phone' as payload_phone, coalesce(pc.id, lc.id) as call_id
    from ${s("tasks")} t
    left join ${s("enquiries")} e on e.id = t.enquiry_id
    left join ${s("callers")} ca on ca.id = e.caller_id
    left join ${s("calls")} pc on pc.id::text = t.payload->>'call_id'
    left join lateral (select c.id from ${s("calls")} c where c.enquiry_id = t.enquiry_id order by c.created_at desc limit 1) lc on true
    where t.kind = 'callback' and t.done_at is null and t.due_at is not null and t.due_at < ${new Date(now.getTime() + SOON_MS)}`;
  for (const row of callbacks) {
    const late = minutesBetween(row.due_at, now);
    const overdue = late > 0;
    items.push({
      id: row.id,
      kind: overdue ? "callback_overdue" : "callback_due",
      tone: overdue ? "danger" : "warn",
      title: `${overdue ? "Callback overdue" : "Callback due soon"}: ${who(row.caller, row.phone ?? row.payload_phone)}`,
      detail: row.reason ?? "Call the client back",
      at: row.due_at,
      minutes: late,
      callId: row.call_id,
    });
  }

  // Existing clients with a problem: urgent tasks for a senior callback, still open.
  const complaints = await sql<{ id: string; due_at: Date | null; created_at: Date; caller: string | null; phone: string | null; payload_phone: string | null; call_id: string | null }[]>`
    select t.id, t.due_at, t.created_at, ca.name as caller, ca.phone_e164 as phone, t.payload->>'phone' as payload_phone, coalesce(pc.id, lc.id) as call_id
    from ${s("tasks")} t
    left join ${s("enquiries")} e on e.id = t.enquiry_id
    left join ${s("callers")} ca on ca.id = e.caller_id
    left join ${s("calls")} pc on pc.id::text = t.payload->>'call_id'
    left join lateral (select c.id from ${s("calls")} c where c.enquiry_id = t.enquiry_id order by c.created_at desc limit 1) lc on true
    where t.kind = 'urgent' and t.done_at is null and t.created_at <= ${now}`;
  for (const row of complaints) {
    const at = row.due_at ?? row.created_at;
    items.push({
      id: row.id,
      kind: "complaint",
      tone: "danger",
      title: `Existing client complaint: ${who(row.caller, row.phone ?? row.payload_phone)}`,
      detail: "Needs a senior callback",
      at,
      minutes: row.due_at ? minutesBetween(row.due_at, now) : null,
      callId: row.call_id,
    });
  }

  // Calls in the last week where the agent said a price figure or asked about budget, unless the
  // founder has already closed the alert. Only the counts are shown, never the flagged lines.
  const flagged = await sql<{ id: string; at: Date; price: number; budget: number; caller: string | null; phone: string | null }[]>`
    select c.id, coalesce(c.started_at, c.created_at) as at, ca.name as caller, ca.phone_e164 as phone,
           case when jsonb_typeof(c.grader_flags->'price_figure') = 'array' then jsonb_array_length(c.grader_flags->'price_figure') else 0 end::int as price,
           case when jsonb_typeof(c.grader_flags->'budget_question') = 'array' then jsonb_array_length(c.grader_flags->'budget_question') else 0 end::int as budget
    from ${s("calls")} c
    left join ${s("callers")} ca on ca.id = c.caller_id
    where coalesce(c.started_at, c.created_at) >= ${new Date(now.getTime() - SAFETY_WINDOW_MS)}
      and coalesce(c.started_at, c.created_at) <= ${now}
      and not exists (select 1 from ${s("tasks")} t where t.kind = 'alert' and t.done_at is not null and t.payload->>'call_id' = c.id::text)`;
  for (const row of flagged) {
    if (row.price + row.budget === 0) continue;
    const parts = [row.price ? `price figure (${row.price})` : null, row.budget ? `budget question (${row.budget})` : null].filter(Boolean);
    items.push({ id: row.id, kind: "safety_flag", tone: "warn", title: `Safety check: ${who(row.caller, row.phone)}`, detail: `Flagged ${parts.join(", ")}: review the call`, at: row.at, minutes: minutesBetween(row.at, now), callId: row.id });
  }

  // Consultations today and tomorrow (IST) that are still on.
  const today = istDayStart(now);
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const consults = await sql<{ id: string; start_at: Date; consult_type: string; caller: string | null; phone: string | null; designer: string | null; call_id: string | null }[]>`
    select b.id, b.start_at, b.consult_type, ca.name as caller, ca.phone_e164 as phone, st.name as designer, lc.id as call_id
    from ${s("bookings")} b
    join ${s("enquiries")} e on e.id = b.enquiry_id
    left join ${s("callers")} ca on ca.id = e.caller_id
    left join ${s("staff")} st on st.id = b.designer_id
    left join lateral (select c.id from ${s("calls")} c where c.enquiry_id = e.id order by c.created_at desc limit 1) lc on true
    where b.status <> 'cancelled' and b.start_at >= ${today} and b.start_at < ${new Date(today.getTime() + 2 * DAY_MS)}`;
  for (const row of consults) {
    const isToday = row.start_at < tomorrow;
    items.push({
      id: row.id,
      kind: isToday ? "consult_today" : "consult_tomorrow",
      tone: "info",
      title: `${CONSULT_LABEL[row.consult_type] ?? "Consultation"} ${isToday ? "today" : "tomorrow"}: ${who(row.caller, row.phone)}`,
      detail: row.designer ? `With ${row.designer}` : "No designer assigned",
      at: row.start_at,
      minutes: minutesBetween(row.start_at, now),
      callId: row.call_id,
    });
  }

  const rank = (kind: AttentionKind) => ATTENTION_ORDER.indexOf(kind);
  return items.sort((a, b) => rank(a.kind) - rank(b.kind) || a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id));
}

// Calls answered, enquiries qualified and consultations booked since midnight IST.
export async function today(sql: postgres.Sql, schema: string, now: Date): Promise<Today> {
  const s = (table: string) => sql(`${schema}.${table}`);
  const from = istDayStart(now);
  const to = new Date(from.getTime() + DAY_MS);
  const [row] = await sql<Today[]>`
    select
      (select count(*) from ${s("calls")} where started_at >= ${from} and started_at < ${to})::int as calls,
      (select count(*) from ${s("enquiries")} where created_at >= ${from} and created_at < ${to} and outcome in ('QUALIFIED', 'QUALIFIED_WITH_NOTES'))::int as qualified,
      (select count(*) from ${s("bookings")} where created_at >= ${from} and created_at < ${to} and status <> 'cancelled')::int as booked`;
  return row;
}
