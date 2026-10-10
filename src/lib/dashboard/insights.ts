// Everything the Overview page shows beyond the plain range totals: the same range compared with the
// period of equal length just before it, daily series for both, the funnel with step rates, a
// designer insight, today's live numbers, upcoming consultations and the most recent calls.
// Range totals come from metrics.ts (overview, costs, designers), so they agree with every other
// dashboard page; the daily series bucket rows on the same timestamps, so each series adds up to
// its total. Days are IST calendar days.
import type postgres from "postgres";
import { maskPhone } from "../phone";
import { istDayStart, today as todayCounts } from "./attention";
import { costs, designers as designerRows, overview, type CostSummary, type DesignerRow, type Overview, type Range } from "./metrics";

export type OverviewSettings = { officeStart: string; officeEnd: string; officeDays: string[]; avgProjectValueInr: number };

export type DayPoint = { day: string; calls: number; enquiries: number; qualified: number; booked: number };

export type CountKpi = { current: number; prior: number; change_pct: number | null };
export type RateKpi = { current: number | null; prior: number | null; change_pp: number | null };

export type FunnelStep = { stage: "enquiries" | "qualified" | "booked" | "consulted" | "won"; value: number; share: number | null; step_rate: number | null };

export type UpcomingConsult = {
  id: string;
  start_at: Date;
  day: "today" | "tomorrow";
  consult_type: string;
  status: string;
  caller: string;
  locality: string | null;
  designer: string | null;
};

export type RecentCall = { id: string; at: Date; caller: string; outcome: string | null; direction: string; duration_s: number | null; dropped: boolean };

export type Insights = {
  range: Range;
  prior: Range;
  days: number;
  current: Overview;
  previous: Overview;
  qualified: { current: number; prior: number };
  kpis: { calls: CountKpi; qualification_rate: RateKpi; booked: CountKpi };
  series: { current: DayPoint[]; prior: DayPoint[] };
  cost: CostSummary;
  funnel: FunnelStep[];
  outcomes: { outcome: string; n: number }[];
  designers: DesignerRow[];
  designer_insight: string | null;
  today: { calls: number; qualified: number; consults: number };
  upcoming: UpcomingConsult[];
  recent: RecentCall[];
};

const DAY_MS = 24 * 60 * 60_000;
const IST_OFFSET_MS = 330 * 60_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Dates are handled as UTC midnights so the machine's own time zone can never shift a day.
const utc = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
export const addDays = (date: string, days: number) => new Date(utc(date) + days * DAY_MS).toISOString().slice(0, 10);
export const rangeDays = (range: Range) => Math.round((utc(range.to) - utc(range.from)) / DAY_MS);
export const istToday = (now: Date) => new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

// The period of equal length that ends where `range` starts.
export function priorRange(range: Range): Range {
  return { from: addDays(range.from, -rangeDays(range)), to: range.from };
}

// The last 14 IST days (today included) unless the URL names a valid range. `to` is exclusive.
export const DEFAULT_DAYS = 14;
export function overviewRange(params: { from?: string; to?: string }, now = new Date()): Range {
  const valid = (value?: string) => (value && ISO_DATE.test(value) && addDays(value, 0) === value ? value : undefined);
  const fallbackTo = addDays(istToday(now), 1);
  const to = valid(params.to) ?? fallbackTo;
  const from = valid(params.from) ?? addDays(to, -DEFAULT_DAYS);
  if (utc(to) <= utc(from)) return { from: addDays(fallbackTo, -DEFAULT_DAYS), to: fallbackTo };
  return { from, to };
}

// Percent change for counts; null when there is nothing to compare against.
export const changePct = (current: number, prior: number) => (prior > 0 ? ((current - prior) / prior) * 100 : null);
// Percentage-point change for rates (0..1 in, points out).
export const changePp = (current: number | null, prior: number | null) => (current === null || prior === null ? null : (current - prior) * 100);

const qualifiedOf = (data: Overview) => (data.outcomes.QUALIFIED ?? 0) + (data.outcomes.QUALIFIED_WITH_NOTES ?? 0);
const rateOf = (qualified: number, enquiries: number) => (enquiries > 0 ? qualified / enquiries : null);

export function funnelSteps(data: Overview): FunnelStep[] {
  const values: [FunnelStep["stage"], number][] = [
    ["enquiries", data.enquiries],
    ["qualified", qualifiedOf(data)],
    ["booked", data.booked],
    ["consulted", data.consulted],
    ["won", data.won],
  ];
  return values.map(([stage, value], i) => ({
    stage,
    value,
    share: data.enquiries > 0 ? value / data.enquiries : null,
    step_rate: i === 0 ? null : values[i - 1][1] > 0 ? value / values[i - 1][1] : null,
  }));
}

export const OUTCOME_ORDER = ["QUALIFIED", "QUALIFIED_WITH_NOTES", "NOT_QUALIFIED", "NEEDS_HUMAN", "NOT_ENQUIRY", "PENDING"];

const shortName = (name: string) => name.replace(/\s*\(.*\)\s*$/, "");
const minutes = (value: number) => `${value.toLocaleString("en-IN", { maximumFractionDigits: 1 })} min`;

// One sentence read off the designer rows: who carries the most assigned leads and who is slowest to
// accept a handoff. Each half is left out when the data cannot support it (no leads, a tie, fewer than
// two designers with an accept time).
export function designerInsight(rows: DesignerRow[]): string | null {
  const working = rows.filter((row) => row.assigned > 0);
  const total = working.reduce((sum, row) => sum + row.assigned, 0);
  if (total === 0) return null;

  const most = Math.max(...working.map((row) => row.assigned));
  const leaders = working.filter((row) => row.assigned === most);
  const leader = leaders.length === 1 && working.length > 1 ? leaders[0] : null;

  const timed = working.filter((row) => row.median_accept_minutes !== null);
  const slowestMinutes = Math.max(...timed.map((row) => row.median_accept_minutes as number));
  const slowest = timed.filter((row) => row.median_accept_minutes === slowestMinutes);
  const slow = timed.length > 1 && slowest.length === 1 && timed.some((row) => (row.median_accept_minutes as number) < slowestMinutes) ? slowest[0] : null;

  const carries = leader ? `${shortName(leader.name)} carries ${Math.round((leader.assigned / total) * 100)}% of assigned leads (${leader.assigned} of ${total})` : null;
  const slowText = slow ? `is the slowest to accept a handoff, at ${minutes(slowestMinutes)} median` : null;
  if (carries && slowText && leader?.id === slow?.id) return `${carries} and ${slowText}.`;
  if (carries && slowText && slow) return `${carries}; ${shortName(slow.name)} ${slowText}.`;
  if (carries) return `${carries}.`;
  if (slowText && slow) return `${shortName(slow.name)} ${slowText}.`;
  return null;
}

const who = (name: string | null, phone: string | null) => name ?? (phone ? maskPhone(phone) : "Unknown caller");

// Daily counts for [from, to), one row per IST day including empty days. Each bucket uses the same
// timestamp as the matching total in metrics.overview(): calls by started_at, enquiries, qualified
// and booked by the enquiry's created_at (booked = has a booking that is not cancelled).
export async function dailySeries(sql: postgres.Sql, schema: string, range: Range): Promise<DayPoint[]> {
  if (rangeDays(range) <= 0) return [];
  const s = (table: string) => sql(`${schema}.${table}`);
  const from = `${range.from}T00:00:00+05:30`;
  const to = `${range.to}T00:00:00+05:30`;
  return sql<DayPoint[]>`
    with days as (
      select d::date as day from generate_series(${range.from}::date, ${range.to}::date - 1, interval '1 day') d
    ), c as (
      select (started_at at time zone 'Asia/Kolkata')::date as day, count(*)::int as calls
      from ${s("calls")} where started_at >= ${from} and started_at < ${to} group by 1
    ), e as (
      select (e.created_at at time zone 'Asia/Kolkata')::date as day,
             count(*)::int as enquiries,
             count(*) filter (where e.outcome in ('QUALIFIED', 'QUALIFIED_WITH_NOTES'))::int as qualified,
             count(*) filter (where exists (select 1 from ${s("bookings")} b where b.enquiry_id = e.id and b.status <> 'cancelled'))::int as booked
      from ${s("enquiries")} e where e.created_at >= ${from} and e.created_at < ${to} group by 1
    )
    select to_char(days.day, 'YYYY-MM-DD') as day,
           coalesce(c.calls, 0)::int as calls,
           coalesce(e.enquiries, 0)::int as enquiries,
           coalesce(e.qualified, 0)::int as qualified,
           coalesce(e.booked, 0)::int as booked
    from days left join c on c.day = days.day left join e on e.day = days.day
    order by days.day`;
}

// Consultations still on for today and tomorrow (IST) that have not finished yet.
async function upcomingConsults(sql: postgres.Sql, schema: string, now: Date): Promise<{ upcoming: UpcomingConsult[]; consultsToday: number }> {
  const s = (table: string) => sql(`${schema}.${table}`);
  const today = istDayStart(now);
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const rows = await sql<{ id: string; start_at: Date; end_at: Date | null; consult_type: string; status: string; caller: string | null; phone: string | null; locality: string | null; designer: string | null }[]>`
    select b.id, b.start_at, b.end_at, b.consult_type, b.status, ca.name as caller, ca.phone_e164 as phone,
           nullif(e.facts->>'locality', '') as locality, st.name as designer
    from ${s("bookings")} b
    join ${s("enquiries")} e on e.id = b.enquiry_id
    left join ${s("callers")} ca on ca.id = e.caller_id
    left join ${s("staff")} st on st.id = b.designer_id
    where b.status <> 'cancelled' and b.start_at >= ${today} and b.start_at < ${new Date(today.getTime() + 2 * DAY_MS)}
    order by b.start_at, b.id`;
  const consultsToday = rows.filter((row) => row.start_at < tomorrow).length;
  const upcoming = rows
    .filter((row) => (row.end_at ?? new Date(row.start_at.getTime() + 60 * 60_000)) > now)
    .map((row) => ({
      id: row.id,
      start_at: row.start_at,
      day: row.start_at < tomorrow ? ("today" as const) : ("tomorrow" as const),
      consult_type: row.consult_type,
      status: row.status,
      caller: who(row.caller, row.phone),
      locality: row.locality,
      designer: row.designer,
    }));
  return { upcoming, consultsToday };
}

// The last `limit` calls up to `now`, oldest first.
export async function recentCalls(sql: postgres.Sql, schema: string, now: Date, limit = 12): Promise<RecentCall[]> {
  const s = (table: string) => sql(`${schema}.${table}`);
  const rows = await sql<{ id: string; at: Date; caller: string | null; phone: string | null; outcome: string | null; direction: string; duration_s: number | null; dropped: boolean }[]>`
    select c.id, coalesce(c.started_at, c.created_at) as at, ca.name as caller, ca.phone_e164 as phone, e.outcome, c.direction, c.duration_s, c.dropped
    from ${s("calls")} c
    left join ${s("callers")} ca on ca.id = c.caller_id
    left join ${s("enquiries")} e on e.id = c.enquiry_id
    where coalesce(c.started_at, c.created_at) <= ${now}
    order by coalesce(c.started_at, c.created_at) desc, c.id desc
    limit ${limit}`;
  return rows.reverse().map((row) => ({ id: row.id, at: row.at, caller: who(row.caller, row.phone), outcome: row.outcome, direction: row.direction, duration_s: row.duration_s, dropped: row.dropped }));
}

export async function insights(sql: postgres.Sql, schema: string, range: Range, settings: OverviewSettings, now = new Date()): Promise<Insights> {
  const prior = priorRange(range);
  const [current, previous, series, priorSeries, designers, live, consults, recent] = await Promise.all([
    overview(sql, schema, range, settings),
    overview(sql, schema, prior, settings),
    dailySeries(sql, schema, range),
    dailySeries(sql, schema, prior),
    designerRows(sql, schema, range),
    todayCounts(sql, schema, now),
    upcomingConsults(sql, schema, now),
    recentCalls(sql, schema, now),
  ]);
  const qualified = { current: qualifiedOf(current), prior: qualifiedOf(previous) };
  const cost = await costs(sql, schema, range, { calls: current.calls, qualified: qualified.current, booked: current.booked, won: current.won });
  const rate = { current: rateOf(qualified.current, current.enquiries), prior: rateOf(qualified.prior, previous.enquiries) };
  return {
    range,
    prior,
    days: rangeDays(range),
    current,
    previous,
    qualified,
    kpis: {
      calls: { current: current.calls, prior: previous.calls, change_pct: changePct(current.calls, previous.calls) },
      qualification_rate: { ...rate, change_pp: changePp(rate.current, rate.prior) },
      booked: { current: current.booked, prior: previous.booked, change_pct: changePct(current.booked, previous.booked) },
    },
    series: { current: series, prior: priorSeries },
    cost,
    funnel: funnelSteps(current),
    outcomes: [...OUTCOME_ORDER, ...Object.keys(current.outcomes).filter((key) => !OUTCOME_ORDER.includes(key))]
      .filter((outcome) => (current.outcomes[outcome] ?? 0) > 0)
      .map((outcome) => ({ outcome, n: current.outcomes[outcome] })),
    designers,
    designer_insight: designerInsight(designers),
    today: { calls: live.calls, qualified: live.qualified, consults: consults.consultsToday },
    upcoming: consults.upcoming,
    recent,
  };
}
