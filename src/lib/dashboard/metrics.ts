// Every number on the founder dashboard, computed in SQL for a date range [from, to) in IST.
import type postgres from "postgres";

export type Range = { from: string; to: string }; // ISO dates, IST, end exclusive

export type Overview = {
  calls: number;
  inbound_calls: number;
  after_hours_calls: number;
  after_hours_share: number;
  enquiries: number;
  outcomes: Record<string, number>;
  top_failing_criterion: { id: string; count: number } | null;
  booked: number;
  consulted: number;
  won: number;
  lost: number;
  pipeline_value_inr: number;
  callbacks_total: number;
  callbacks_on_time: number;
  handoffs_posted: number;
  median_accept_minutes: number | null;
  escalations: number;
};

export type CostSummary = {
  variable_inr: number;
  fixed_inr: number;
  total_inr: number;
  by_kind: Record<string, number>;
  per_call: number | null;
  per_qualified_lead: number | null;
  per_booking: number | null;
  per_won: number | null;
};

export type DesignerRow = { id: string; name: string; assigned: number; median_accept_minutes: number | null; escalations: number; won: number; lost: number; won_rate: number | null };

const ist = (date: string) => `${date}T00:00:00+05:30`;

export async function overview(sql: postgres.Sql, schema: string, range: Range, settings: { officeStart: string; officeEnd: string; officeDays: string[]; avgProjectValueInr: number }): Promise<Overview> {
  const s = (table: string) => sql(`${schema}.${table}`);
  const from = ist(range.from);
  const to = ist(range.to);
  const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const officeDow = settings.officeDays.map((day) => dayNames.indexOf(day));

  const [calls] = await sql<{ calls: number; inbound: number; after_hours: number }[]>`
    select count(*)::int as calls,
           count(*) filter (where direction = 'in')::int as inbound,
           count(*) filter (where direction = 'in' and (
             extract(dow from started_at at time zone 'Asia/Kolkata')::int <> all(${officeDow}::int[])
             or (started_at at time zone 'Asia/Kolkata')::time < ${settings.officeStart}::time
             or (started_at at time zone 'Asia/Kolkata')::time >= ${settings.officeEnd}::time))::int as after_hours
    from ${s("calls")} where started_at >= ${from} and started_at < ${to}`;

  const outcomeRows = await sql<{ outcome: string; n: number }[]>`
    select outcome, count(*)::int as n from ${s("enquiries")}
    where created_at >= ${from} and created_at < ${to} group by outcome`;
  const outcomes = Object.fromEntries(outcomeRows.map((row) => [row.outcome, row.n]));

  const [failing] = await sql<{ id: string; n: number }[]>`
    select c->>'id' as id, count(*)::int as n
    from ${s("enquiries")} e, jsonb_array_elements(case when jsonb_typeof(e.criteria) = 'array' then e.criteria else '[]'::jsonb end) c
    where e.created_at >= ${from} and e.created_at < ${to} and e.outcome = 'NOT_QUALIFIED' and c->>'state' = 'fail'
    group by 1 order by 2 desc, 1 limit 1`;

  const [funnel] = await sql<{ booked: number; consulted: number; won: number; lost: number }[]>`
    select count(distinct e.id) filter (where b.id is not null)::int as booked,
           count(distinct e.id) filter (where b.start_at < now())::int as consulted,
           count(distinct e.id) filter (where e.consult_result = 'won')::int as won,
           count(distinct e.id) filter (where e.consult_result = 'lost')::int as lost
    from ${s("enquiries")} e
    left join ${s("bookings")} b on b.enquiry_id = e.id and b.status <> 'cancelled'
    where e.created_at >= ${from} and e.created_at < ${to}`;

  const [callbacks] = await sql<{ total: number; on_time: number }[]>`
    select count(*)::int as total,
           count(*) filter (where done_at is not null and (due_at is null or done_at <= due_at))::int as on_time
    from ${s("tasks")} where kind = 'callback' and created_at >= ${from} and created_at < ${to}`;

  const [handoffs] = await sql<{ posted: number; median: number | null; escalations: number }[]>`
    select count(*)::int as posted,
           percentile_cont(0.5) within group (order by extract(epoch from accepted_at - posted_at) / 60)
             filter (where accepted_at is not null) as median,
           count(*) filter (where escalated_at is not null)::int as escalations
    from ${s("handoffs")} where posted_at >= ${from} and posted_at < ${to}`;

  const enquiries = outcomeRows.reduce((sum, row) => sum + row.n, 0);
  return {
    calls: calls.calls,
    inbound_calls: calls.inbound,
    after_hours_calls: calls.after_hours,
    after_hours_share: calls.inbound ? calls.after_hours / calls.inbound : 0,
    enquiries,
    outcomes,
    top_failing_criterion: failing ? { id: failing.id, count: failing.n } : null,
    booked: funnel.booked,
    consulted: funnel.consulted,
    won: funnel.won,
    lost: funnel.lost,
    pipeline_value_inr: funnel.won * settings.avgProjectValueInr,
    callbacks_total: callbacks.total,
    callbacks_on_time: callbacks.on_time,
    handoffs_posted: handoffs.posted,
    median_accept_minutes: handoffs.median === null ? null : Math.round(Number(handoffs.median) * 10) / 10,
    escalations: handoffs.escalations,
  };
}

export async function costs(sql: postgres.Sql, schema: string, range: Range, counts: { calls: number; qualified: number; booked: number; won: number }): Promise<CostSummary> {
  const s = (table: string) => sql(`${schema}.${table}`);
  const rows = await sql<{ kind: string; amount: number }[]>`
    select kind, coalesce(sum(amount_inr), 0)::float as amount from ${s("cost_lines")}
    where recorded_at >= ${ist(range.from)} and recorded_at < ${ist(range.to)} group by kind`;
  const [fixed] = await sql<{ amount: number }[]>`
    select coalesce(sum(amount_inr), 0)::float as amount from ${s("fixed_costs")}
    where month >= date_trunc('month', ${range.from}::date) and month < ${range.to}::date`;
  const by_kind = Object.fromEntries(rows.map((row) => [row.kind, Math.round(row.amount * 100) / 100]));
  const variable = rows.reduce((sum, row) => sum + row.amount, 0);
  const total = variable + fixed.amount;
  const per = (n: number) => (n > 0 ? Math.round((total / n) * 100) / 100 : null);
  return {
    variable_inr: Math.round(variable * 100) / 100,
    fixed_inr: Math.round(fixed.amount * 100) / 100,
    total_inr: Math.round(total * 100) / 100,
    by_kind,
    per_call: per(counts.calls),
    per_qualified_lead: per(counts.qualified),
    per_booking: per(counts.booked),
    per_won: per(counts.won),
  };
}

export async function designers(sql: postgres.Sql, schema: string, range: Range): Promise<DesignerRow[]> {
  const s = (table: string) => sql(`${schema}.${table}`);
  const rows = await sql<{ id: string; name: string; assigned: number; median: number | null; escalations: number; won: number; lost: number }[]>`
    select st.id, st.name,
           count(distinct e.id)::int as assigned,
           percentile_cont(0.5) within group (order by extract(epoch from h.accepted_at - h.posted_at) / 60) filter (where h.accepted_at is not null) as median,
           count(distinct h.id) filter (where h.escalated_at is not null)::int as escalations,
           count(distinct e.id) filter (where e.consult_result = 'won')::int as won,
           count(distinct e.id) filter (where e.consult_result = 'lost')::int as lost
    from ${s("staff")} st
    left join ${s("enquiries")} e on e.assigned_designer_id = st.id and e.created_at >= ${ist(range.from)} and e.created_at < ${ist(range.to)}
    left join ${s("handoffs")} h on h.enquiry_id = e.id
    where st.role = 'designer' and st.active
    group by st.id, st.name order by st.name`;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    assigned: row.assigned,
    median_accept_minutes: row.median === null ? null : Math.round(Number(row.median) * 10) / 10,
    escalations: row.escalations,
    won: row.won,
    lost: row.lost,
    won_rate: row.won + row.lost > 0 ? row.won / (row.won + row.lost) : null,
  }));
}

export function defaultRange(now = new Date()): Range {
  const istNow = new Date(now.getTime() + 330 * 60_000);
  const first = `${istNow.toISOString().slice(0, 7)}-01`;
  const next = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  return { from: first, to: next };
}

export function parseRange(params: { from?: string; to?: string }, now = new Date()): Range {
  const valid = (value?: string) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined);
  const fallback = defaultRange(now);
  return { from: valid(params.from) ?? fallback.from, to: valid(params.to) ?? fallback.to };
}
