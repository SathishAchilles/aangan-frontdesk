// Everything the designer area reads. One designer's view of the studio: the enquiries they own and
// the handoffs they may accept, never another designer's leads.
//
// A designer owns an enquiry when it is assigned to them or they accepted its handoff (accepting an
// unassigned handoff, on Telegram or here, sets only handoffs.accepted_by).
// A designer may accept a handoff that is posted, not yet accepted, and either assigned to them or
// unassigned with a consultation type listed in their staff.consult_types (no type yet counts as a
// studio consultation, as the Telegram message does).
import type postgres from "postgres";
import { ESCALATION_WINDOW_DAYS } from "@/lib/dashboard/attention";
import type { Range } from "@/lib/dashboard/metrics";
import { istStart, scopeSummary, validUuid } from "@/lib/dashboard/schedule";
import { maskPhone } from "@/lib/phone";
import { performance, type Performance } from "./performance";
import { withoutPrice } from "./redact";

export type Designer = { id: string; name: string; consultTypes: string[] };
type Sql = postgres.Sql;
type Facts = Parameters<typeof scopeSummary>[0];

const table = (sql: Sql, schema: string) => (name: string) => sql(`${schema}.${name}`);
const localityOf = (facts: Facts | null) => (facts && typeof facts.locality === "string" && facts.locality.trim() ? facts.locality.trim() : null);
const noteSummary = (note: unknown) => (note && typeof note === "object" ? withoutPrice((note as Record<string, unknown>).one_line_summary) : null);

// SQL conditions over `e` (enquiries) and `h` (its handoff, left-joined).
export const ownedBy = (sql: Sql, designerId: string) => sql`(e.assigned_designer_id = ${designerId} or h.accepted_by = ${designerId})`;
export const acceptableBy = (sql: Sql, schema: string, designerId: string) => sql`(
  h.posted_at is not null and h.accepted_at is null and (
    e.assigned_designer_id = ${designerId}
    or (e.assigned_designer_id is null and coalesce(e.consult_type, 'studio') = any(
      coalesce((select st.consult_types from ${sql(`${schema}.staff`)} st where st.id = ${designerId} and st.active and st.role = 'designer'), '{}'::text[])))))`;

export async function loadDesigner(sql: Sql, schema: string, id: string | undefined): Promise<Designer | null> {
  const staffId = validUuid(id);
  if (!staffId) return null;
  const [row] = await sql<{ id: string; name: string; consult_types: string[] }[]>`
    select id, name, consult_types from ${sql(`${schema}.staff`)} where id = ${staffId} and role = 'designer' and active`;
  return row ? { id: row.id, name: row.name, consultTypes: row.consult_types ?? [] } : null;
}

export async function activeDesigners(sql: Sql, schema: string): Promise<Designer[]> {
  const rows = await sql<{ id: string; name: string; consult_types: string[] }[]>`
    select id, name, consult_types from ${sql(`${schema}.staff`)} where role = 'designer' and active order by name`;
  return rows.map((row) => ({ id: row.id, name: row.name, consultTypes: row.consult_types ?? [] }));
}

export type WaitingHandoff = {
  handoffId: string;
  enquiryId: string;
  postedAt: Date;
  escalated: boolean;
  forMe: boolean;
  callerName: string | null;
  phoneMasked: string | null;
  locality: string | null;
  scope: string | null;
  summary: string | null;
  consultType: string | null;
  bookingAt: Date | null;
};

// Handoffs this designer may accept now, longest waiting first. Escalations older than the admin
// panel's window are left out there too: those leads have gone cold.
export async function waitingHandoffs(sql: Sql, schema: string, designerId: string, now: Date): Promise<WaitingHandoff[]> {
  const s = table(sql, schema);
  const since = new Date(now.getTime() - ESCALATION_WINDOW_DAYS * 86_400_000);
  const rows = await sql<
    { id: string; enquiry_id: string; posted_at: Date; escalated_at: Date | null; assigned: string | null; caller: string | null; phone: string | null; facts: Facts | null; note: unknown; consult_type: string | null; booking_at: Date | null }[]
  >`
    select h.id, e.id as enquiry_id, h.posted_at, h.escalated_at, e.assigned_designer_id as assigned, ca.name as caller, ca.phone_e164 as phone,
           e.facts, h.note, coalesce(b.consult_type, e.consult_type) as consult_type, b.start_at as booking_at
    from ${s("handoffs")} h
    join ${s("enquiries")} e on e.id = h.enquiry_id
    left join ${s("callers")} ca on ca.id = e.caller_id
    left join lateral (
      select start_at, consult_type from ${s("bookings")} where enquiry_id = e.id and status <> 'cancelled' order by created_at desc limit 1
    ) b on true
    where ${acceptableBy(sql, schema, designerId)} and h.posted_at <= ${now} and h.posted_at > ${since}
    order by h.posted_at, h.id`;
  return rows.map((row) => ({
    handoffId: row.id,
    enquiryId: row.enquiry_id,
    postedAt: row.posted_at,
    escalated: row.escalated_at !== null,
    forMe: row.assigned === designerId,
    callerName: row.caller,
    phoneMasked: row.phone ? maskPhone(row.phone) : null,
    locality: localityOf(row.facts),
    scope: scopeSummary(row.facts ?? {}),
    summary: noteSummary(row.note),
    consultType: row.consult_type,
    bookingAt: row.booking_at,
  }));
}

export type Callback = { taskId: string; enquiryId: string | null; reason: string | null; dueAt: Date | null; callerName: string | null };

// Tasks have no assignee: a callback is "mine" when it is about an enquiry I own.
export async function myCallbacks(sql: Sql, schema: string, designerId: string): Promise<Callback[]> {
  const s = table(sql, schema);
  const rows = await sql<{ id: string; enquiry_id: string | null; reason: string | null; due_at: Date | null; caller: string | null }[]>`
    select t.id, t.enquiry_id, t.reason, t.due_at, ca.name as caller
    from ${s("tasks")} t
    join ${s("enquiries")} e on e.id = t.enquiry_id
    left join ${s("handoffs")} h on h.enquiry_id = e.id
    left join ${s("callers")} ca on ca.id = e.caller_id
    where t.kind = 'callback' and t.done_at is null and ${ownedBy(sql, designerId)}
    order by t.due_at nulls last, t.created_at`;
  return rows.map((row) => ({ taskId: row.id, enquiryId: row.enquiry_id, reason: withoutPrice(row.reason), dueAt: row.due_at, callerName: row.caller }));
}

export type Activity = { at: Date; kind: "handoff" | "accepted" | "booked" | "rescheduled" | "cancelled" | "won" | "lost"; enquiryId: string; callerName: string | null };

export async function recentActivity(sql: Sql, schema: string, designerId: string, now: Date, limit = 8): Promise<Activity[]> {
  const s = table(sql, schema);
  const rows = await sql<{ at: Date; kind: Activity["kind"]; enquiry_id: string; caller: string | null }[]>`
    with mine as (
      select e.id, e.consult_result, e.consult_result_at, ca.name as caller, h.posted_at, h.accepted_at, h.accepted_by
      from ${s("enquiries")} e
      left join ${s("handoffs")} h on h.enquiry_id = e.id
      left join ${s("callers")} ca on ca.id = e.caller_id
      where ${ownedBy(sql, designerId)}
    )
    select * from (
      select posted_at as at, 'handoff' as kind, id as enquiry_id, caller from mine where posted_at is not null
      union all
      select accepted_at, 'accepted', id, caller from mine where accepted_at is not null and accepted_by = ${designerId}
      union all
      select case when b.status = 'booked' then b.created_at else b.updated_at end, b.status, m.id, m.caller
      from mine m join ${s("bookings")} b on b.enquiry_id = m.id
      union all
      select consult_result_at, consult_result, id, caller from mine where consult_result is not null and consult_result_at is not null
    ) events
    where at <= ${now}
    order by at desc
    limit ${limit}`;
  return rows.map((row) => ({ at: row.at, kind: row.kind, enquiryId: row.enquiry_id, callerName: row.caller }));
}

// booking id -> enquiry id, so calendar meetings can open the designer's own lead page.
export async function bookingLeads(sql: Sql, schema: string, bookingIds: string[]): Promise<Map<string, string>> {
  if (bookingIds.length === 0) return new Map();
  const rows = await sql<{ id: string; enquiry_id: string }[]>`select id, enquiry_id from ${sql(`${schema}.bookings`)} where id = any(${bookingIds}::uuid[])`;
  return new Map(rows.map((row) => [row.id, row.enquiry_id]));
}

export type LeadRow = {
  enquiryId: string;
  createdAt: Date;
  callerName: string | null;
  phoneMasked: string | null;
  locality: string | null;
  scope: string | null;
  outcome: string;
  consultType: string | null;
  booking: { startAt: Date; status: string; consultType: string } | null;
  acceptedAt: Date | null;
  result: "won" | "lost" | null;
  needsResult: boolean;
};

export async function myLeads(sql: Sql, schema: string, designerId: string, now: Date, limit = 200): Promise<LeadRow[]> {
  const s = table(sql, schema);
  const rows = await sql<
    {
      id: string;
      created_at: Date;
      caller: string | null;
      phone: string | null;
      facts: Facts | null;
      outcome: string;
      consult_type: string | null;
      start_at: Date | null;
      status: string | null;
      booking_type: string | null;
      accepted_at: Date | null;
      result: "won" | "lost" | null;
      consulted: boolean;
    }[]
  >`
    select e.id, e.created_at, ca.name as caller, ca.phone_e164 as phone, e.facts, e.outcome, e.consult_type,
           b.start_at, b.status, b.consult_type as booking_type, h.accepted_at, e.consult_result as result,
           exists (select 1 from ${s("bookings")} x where x.enquiry_id = e.id and x.status <> 'cancelled' and x.start_at < ${now}) as consulted
    from ${s("enquiries")} e
    left join ${s("handoffs")} h on h.enquiry_id = e.id
    left join ${s("callers")} ca on ca.id = e.caller_id
    left join lateral (
      select start_at, status, consult_type from ${s("bookings")} where enquiry_id = e.id order by (status = 'cancelled'), created_at desc limit 1
    ) b on true
    where ${ownedBy(sql, designerId)}
    order by e.created_at desc
    limit ${limit}`;
  return rows.map((row) => ({
    enquiryId: row.id,
    createdAt: row.created_at,
    callerName: row.caller,
    phoneMasked: row.phone ? maskPhone(row.phone) : null,
    locality: localityOf(row.facts),
    scope: scopeSummary(row.facts ?? {}),
    outcome: row.outcome,
    consultType: row.booking_type ?? row.consult_type,
    booking: row.start_at && row.status && row.booking_type ? { startAt: row.start_at, status: row.status, consultType: row.booking_type } : null,
    acceptedAt: row.accepted_at,
    result: row.result,
    needsResult: row.consulted && row.result === null,
  }));
}

export type LeadDetail = {
  enquiryId: string;
  owned: boolean;
  createdAt: Date;
  callerName: string | null;
  phone: string | null;
  phoneMasked: string | null;
  locality: string | null;
  scope: string | null;
  outcome: string;
  consultType: string | null;
  flags: string[];
  assignedTo: string | null;
  result: "won" | "lost" | null;
  resultAt: Date | null;
  handoff: { id: string; postedAt: Date | null; acceptedAt: Date | null; acceptedBy: string | null; escalated: boolean; note: unknown; acceptable: boolean } | null;
  bookings: { id: string; startAt: Date; status: string; consultType: string; designer: string | null }[];
  calls: { id: string; startedAt: Date | null; durationS: number | null; summary: string | null; transcript: string | null; recordingUrl: string | null }[];
  canRecordResult: boolean;
};

// One enquiry, if this designer owns it or may accept its handoff; otherwise null (a 404 to them).
export async function leadDetail(sql: Sql, schema: string, designerId: string, enquiryId: string, now: Date): Promise<LeadDetail | null> {
  const id = validUuid(enquiryId);
  if (!id) return null;
  const s = table(sql, schema);
  const [row] = await sql<
    {
      id: string;
      created_at: Date;
      caller: string | null;
      phone: string | null;
      facts: Facts | null;
      outcome: string;
      consult_type: string | null;
      flags: string[];
      assigned: string | null;
      result: "won" | "lost" | null;
      result_at: Date | null;
      handoff_id: string | null;
      posted_at: Date | null;
      accepted_at: Date | null;
      accepter: string | null;
      escalated_at: Date | null;
      note: unknown;
      owned: boolean;
      acceptable: boolean;
    }[]
  >`
    select e.id, e.created_at, ca.name as caller, ca.phone_e164 as phone, e.facts, e.outcome, e.consult_type, e.flags,
           st.name as assigned, e.consult_result as result, e.consult_result_at as result_at,
           h.id as handoff_id, h.posted_at, h.accepted_at, acc.name as accepter, h.escalated_at, h.note,
           coalesce(${ownedBy(sql, designerId)}, false) as owned,
           coalesce(${acceptableBy(sql, schema, designerId)}, false) as acceptable
    from ${s("enquiries")} e
    left join ${s("handoffs")} h on h.enquiry_id = e.id
    left join ${s("callers")} ca on ca.id = e.caller_id
    left join ${s("staff")} st on st.id = e.assigned_designer_id
    left join ${s("staff")} acc on acc.id = h.accepted_by
    where e.id = ${id}`;
  if (!row || !(row.owned || row.acceptable)) return null;
  const bookings = await sql<{ id: string; start_at: Date; status: string; consult_type: string; designer: string | null }[]>`
    select b.id, b.start_at, b.status, b.consult_type, st.name as designer
    from ${s("bookings")} b left join ${s("staff")} st on st.id = b.designer_id
    where b.enquiry_id = ${id} order by b.start_at`;
  const calls = await sql<{ id: string; started_at: Date | null; duration_s: number | null; summary: string | null; transcript: string | null; recording_url: string | null }[]>`
    select id, started_at, duration_s, summary, transcript, recording_url from ${s("calls")}
    where enquiry_id = ${id} order by started_at desc nulls last, created_at desc`;
  const consulted = bookings.some((booking) => booking.status !== "cancelled" && booking.start_at.getTime() < now.getTime());
  return {
    enquiryId: row.id,
    owned: row.owned,
    createdAt: row.created_at,
    callerName: row.caller,
    // The full number is only ever handed to the designer who owns the lead: they have to call.
    phone: row.owned ? row.phone : null,
    phoneMasked: row.phone ? maskPhone(row.phone) : null,
    locality: localityOf(row.facts),
    scope: scopeSummary(row.facts ?? {}),
    outcome: row.outcome,
    consultType: row.consult_type,
    flags: row.flags ?? [],
    assignedTo: row.assigned,
    result: row.result,
    resultAt: row.result_at,
    handoff: row.handoff_id
      ? { id: row.handoff_id, postedAt: row.posted_at, acceptedAt: row.accepted_at, acceptedBy: row.accepter, escalated: row.escalated_at !== null, note: row.note, acceptable: row.acceptable }
      : null,
    bookings: bookings.map((booking) => ({ id: booking.id, startAt: booking.start_at, status: booking.status, consultType: booking.consult_type, designer: booking.designer })),
    calls: calls.map((call) => ({ id: call.id, startedAt: call.started_at, durationS: call.duration_s, summary: withoutPrice(call.summary), transcript: call.transcript, recordingUrl: call.recording_url })),
    canRecordResult: row.owned && row.result === null && consulted,
  };
}

// The raw rows performance() needs for a range, studio-wide; the comparison happens in code.
export async function designerPerformance(sql: Sql, schema: string, designerId: string, range: Range, now: Date, limitMin: number): Promise<Performance> {
  const s = table(sql, schema);
  const from = istStart(range.from);
  const to = istStart(range.to);
  const handoffs = await sql<{ posted_at: Date; accepted_at: Date | null; accepted_by: string | null; assigned_to: string | null }[]>`
    select h.posted_at, h.accepted_at, h.accepted_by, e.assigned_designer_id as assigned_to
    from ${s("handoffs")} h join ${s("enquiries")} e on e.id = h.enquiry_id
    where h.posted_at >= ${from} and h.posted_at < ${to} and h.posted_at <= ${now}`;
  const consults = await sql<{ start_at: Date; designer_id: string | null }[]>`
    select start_at, designer_id from ${s("bookings")}
    where status <> 'cancelled' and start_at >= ${from} and start_at < ${to} and start_at < ${now}`;
  // Same cohort as the admin Designers table: enquiries created in the range that have a result. The
  // designer who accepted the handoff took the consultation; otherwise the one it was assigned to.
  const results = await sql<{ created_at: Date; result: "won" | "lost"; owner: string | null }[]>`
    select e.created_at, e.consult_result as result, coalesce(h.accepted_by, e.assigned_designer_id) as owner
    from ${s("enquiries")} e left join ${s("handoffs")} h on h.enquiry_id = e.id
    where e.consult_result is not null and e.created_at >= ${from} and e.created_at < ${to}`;
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from ${s("staff")} where role = 'designer' and active`;
  return performance({ me: designerId, range, limitMin, designers: n, handoffs, consults, results });
}
