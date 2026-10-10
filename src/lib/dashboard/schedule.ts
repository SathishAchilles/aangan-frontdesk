// Scheduled consultations for the designers calendar. Every date here is an IST calendar date
// ("YYYY-MM-DD"); India has no daylight saving, so IST is a fixed UTC+05:30 offset.
import type postgres from "postgres";
import { containsPriceFigure } from "@/evals/graders/deterministic";
import { maskPhone } from "@/lib/phone";
import { CONSULT_TYPES } from "@/db/schema";

export type ConsultType = (typeof CONSULT_TYPES)[number];
export type BookingStatus = "booked" | "rescheduled" | "cancelled";

// Cal.com usually sends an end time; when it does not, a meeting lasts this long.
export const DEFAULT_DURATION_MIN: Record<ConsultType, number> = { studio: 60, site: 90, principal: 60 };

export type Meeting = {
  id: string;
  start: Date;
  end: Date;
  day: string; // IST date of the start
  consult_type: ConsultType;
  status: BookingStatus;
  designer_id: string | null;
  designer_name: string | null;
  caller_name: string | null;
  phone_masked: string | null;
  locality: string | null;
  scope: string | null;
  call_id: string | null;
};

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The instant an IST date begins.
export const istStart = (date: string) => new Date(`${date}T00:00:00+05:30`);
export const istDate = (instant: Date) => new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
// Minutes since IST midnight.
export const istMinutes = (instant: Date) => {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
};
export const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
// Monday of the week an IST date falls in.
export const mondayOf = (date: string) => addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));

export function validDate(value: string | undefined): string | undefined {
  if (!value || !DATE_RE.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : undefined;
}

export const validUuid = (value: string | undefined) => (value && UUID_RE.test(value) ? value.toLowerCase() : undefined);

const PROPERTY_KIND: Record<string, string> = { apartment: "Apartment", villa: "Villa", independent_house: "Independent house", office: "Office", other: "Other property" };

type Facts = { property_kind?: string; full_home?: boolean; rooms?: string[]; sqft?: number; scope_text?: string; locality?: string };

// What the visit is about. Built from structured facts; the caller's own words are added only when
// they contain no cost figure, because the dashboard never shows a price.
export function scopeSummary(facts: Facts): string | null {
  const parts: string[] = [];
  if (facts.property_kind && PROPERTY_KIND[facts.property_kind]) parts.push(PROPERTY_KIND[facts.property_kind]);
  if (facts.full_home) parts.push("full home");
  else if (Array.isArray(facts.rooms) && facts.rooms.length > 0) parts.push(facts.rooms.slice(0, 4).join(", "));
  if (typeof facts.sqft === "number" && facts.sqft > 0) parts.push(`${facts.sqft.toLocaleString("en-IN")} sq ft`);
  const text = typeof facts.scope_text === "string" ? facts.scope_text.trim() : "";
  if (text && !containsPriceFigure(text)) parts.push(text.length > 110 ? `${text.slice(0, 109).trimEnd()}…` : text);
  return parts.length > 0 ? parts.join(" · ") : null;
}

// Bookings whose time span overlaps [fromIst, toIst) (IST dates, end exclusive), earliest first.
export async function schedule(sql: postgres.Sql, schema: string, fromIst: string, toIst: string, designerId?: string): Promise<Meeting[]> {
  const s = (table: string) => sql(`${schema}.${table}`);
  const designer = validUuid(designerId) ?? null;
  const d = DEFAULT_DURATION_MIN;
  const rows = await sql<
    {
      id: string;
      start_at: Date;
      end_at: Date;
      consult_type: ConsultType;
      status: BookingStatus;
      designer_id: string | null;
      designer_name: string | null;
      caller_name: string | null;
      phone: string | null;
      facts: Facts | null;
      call_id: string | null;
    }[]
  >`
    select b.id, b.start_at, m.end_at, b.consult_type, b.status, b.designer_id, st.name as designer_name,
           ca.name as caller_name, ca.phone_e164 as phone, e.facts, c.id as call_id
    from ${s("bookings")} b
    join ${s("enquiries")} e on e.id = b.enquiry_id
    left join ${s("staff")} st on st.id = b.designer_id
    left join ${s("callers")} ca on ca.id = e.caller_id
    cross join lateral (
      select coalesce(b.end_at, b.start_at + make_interval(mins => case b.consult_type when 'studio' then ${d.studio}::int when 'site' then ${d.site}::int else ${d.principal}::int end)) as end_at
    ) m
    left join lateral (
      select id from ${s("calls")} where enquiry_id = e.id order by started_at desc nulls last, created_at desc limit 1
    ) c on true
    where b.start_at < ${istStart(toIst)} and m.end_at > ${istStart(fromIst)}
      and (${designer}::uuid is null or b.designer_id = ${designer}::uuid)
    order by b.start_at, st.name nulls last, b.id`;
  return rows.map((row) => {
    const facts = row.facts ?? {};
    return {
      id: row.id,
      start: row.start_at,
      end: row.end_at,
      day: istDate(row.start_at),
      consult_type: row.consult_type,
      status: row.status,
      designer_id: row.designer_id,
      designer_name: row.designer_name,
      caller_name: row.caller_name,
      phone_masked: row.phone ? maskPhone(row.phone) : null,
      locality: typeof facts.locality === "string" && facts.locality.trim() ? facts.locality.trim() : null,
      scope: scopeSummary(facts),
      call_id: row.call_id,
    };
  });
}

export type Placed<T> = { item: T; lane: number; lanes: number };

// Side-by-side layout for one column: meetings that overlap (directly or through a chain) form a
// cluster; each takes the first free lane and the cluster is split into equal-width lanes.
export function placeOverlaps<T extends { start: Date; end: Date }>(items: T[]): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime());
  const placed: Placed<T>[] = [];
  let cluster: Placed<T>[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;
  const close = () => {
    for (const entry of cluster) entry.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };
  for (const item of sorted) {
    const start = item.start.getTime();
    if (start >= clusterEnd) {
      close();
      clusterEnd = -Infinity;
    }
    let lane = laneEnds.findIndex((end) => end <= start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = item.end.getTime();
    clusterEnd = Math.max(clusterEnd, item.end.getTime());
    const entry = { item, lane, lanes: 1 };
    cluster.push(entry);
    placed.push(entry);
  }
  close();
  return placed;
}
