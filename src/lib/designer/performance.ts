// One designer's numbers next to the studio's for a date range, plus a short series for each so the
// page can draw sparklines. Pure: the rows come from queries.ts, so this is tested without a database.
import { addDays, istDate } from "@/lib/dashboard/schedule";
import type { Range } from "@/lib/dashboard/metrics";

export type HandoffRow = { posted_at: Date; accepted_at: Date | null; accepted_by: string | null; assigned_to: string | null };
export type ConsultRow = { start_at: Date; designer_id: string | null };
export type ResultRow = { created_at: Date; result: "won" | "lost"; owner: string | null };

export type KpiKey = "median_accept" | "within_limit" | "consultations" | "won" | "win_rate";
export type Kpi = {
  key: KpiKey;
  label: string;
  unit: "min" | "pct" | "count";
  better: "lower" | "higher";
  mine: number | null;
  studio: number | null;
  series: { mine: (number | null)[]; studio: (number | null)[] };
};
export type Performance = { kpis: Kpi[]; buckets: string[]; bucketDays: number; designers: number; limitMin: number };

const DAY_MS = 86_400_000;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round1 = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10);
const share = (part: number, whole: number) => (whole > 0 ? part / whole : null);

// Daily points for up to two months, weekly beyond that.
export function bucketsFor(range: Range): { starts: string[]; days: number } {
  const span = Math.max(1, Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / DAY_MS));
  const days = span <= 62 ? 1 : 7;
  const starts: string[] = [];
  for (let offset = 0; offset < span; offset += days) starts.push(addDays(range.from, offset));
  return { starts, days };
}

export function performance(input: {
  me: string;
  range: Range;
  limitMin: number;
  designers: number;
  handoffs: HandoffRow[];
  consults: ConsultRow[];
  results: ResultRow[];
}): Performance {
  const { me, range, limitMin } = input;
  const designers = Math.max(1, input.designers);
  const { starts, days } = bucketsFor(range);
  const bucketOf = (instant: Date) => {
    const offset = Math.round((Date.parse(`${istDate(instant)}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / DAY_MS);
    const index = Math.floor(offset / days);
    return index >= 0 && index < starts.length ? index : -1;
  };
  const perBucket = <T>(rows: T[], at: (row: T) => Date) => {
    const out: T[][] = starts.map(() => []);
    for (const row of rows) {
      const index = bucketOf(at(row));
      if (index !== -1) out[index].push(row);
    }
    return out;
  };

  const minutes = (row: HandoffRow) => (row.accepted_at ? (row.accepted_at.getTime() - row.posted_at.getTime()) / 60_000 : null);
  const isMine = (row: HandoffRow) => row.assigned_to === me || row.accepted_by === me;
  const acceptMinutes = (rows: HandoffRow[], mine: boolean) =>
    rows.filter((row) => row.accepted_at && (!mine || row.accepted_by === me)).map((row) => minutes(row) as number);
  // A handoff counts against whoever it was meant for; it is "within the limit" only if accepted in time.
  const withinShare = (rows: HandoffRow[], mine: boolean) => {
    const pool = mine ? rows.filter(isMine) : rows;
    const inTime = pool.filter((row) => row.accepted_at && (!mine || row.accepted_by === me) && (minutes(row) as number) <= limitMin);
    return share(inTime.length, pool.length);
  };
  const handoffBuckets = perBucket(input.handoffs, (row) => row.posted_at);

  const myConsults = (rows: ConsultRow[]) => rows.filter((row) => row.designer_id === me).length;
  const consultBuckets = perBucket(input.consults, (row) => row.start_at);

  const won = (rows: ResultRow[], mine: boolean) => rows.filter((row) => row.result === "won" && (!mine || row.owner === me)).length;
  const decided = (rows: ResultRow[], mine: boolean) => rows.filter((row) => !mine || row.owner === me).length;
  const resultBuckets = perBucket(input.results, (row) => row.created_at);
  // Win rate is drawn as a running rate: a single day rarely has a decided consultation.
  const runningRate = (mine: boolean) => {
    let w = 0;
    let n = 0;
    return resultBuckets.map((rows) => {
      w += won(rows, mine);
      n += decided(rows, mine);
      return share(w, n);
    });
  };

  const kpis: Kpi[] = [
    {
      key: "median_accept",
      label: "Median accept time",
      unit: "min",
      better: "lower",
      mine: round1(median(acceptMinutes(input.handoffs, true))),
      studio: round1(median(acceptMinutes(input.handoffs, false))),
      series: { mine: handoffBuckets.map((rows) => round1(median(acceptMinutes(rows, true)))), studio: handoffBuckets.map((rows) => round1(median(acceptMinutes(rows, false)))) },
    },
    {
      key: "within_limit",
      label: `Accepted within ${limitMin} min`,
      unit: "pct",
      better: "higher",
      mine: withinShare(input.handoffs, true),
      studio: withinShare(input.handoffs, false),
      series: { mine: handoffBuckets.map((rows) => withinShare(rows, true)), studio: handoffBuckets.map((rows) => withinShare(rows, false)) },
    },
    {
      key: "consultations",
      label: "Consultations held",
      unit: "count",
      better: "higher",
      mine: myConsults(input.consults),
      studio: round1(input.consults.length / designers),
      series: { mine: consultBuckets.map(myConsults), studio: consultBuckets.map((rows) => round1(rows.length / designers)) },
    },
    {
      key: "won",
      label: "Projects won",
      unit: "count",
      better: "higher",
      mine: won(input.results, true),
      studio: round1(won(input.results, false) / designers),
      series: { mine: resultBuckets.map((rows) => won(rows, true)), studio: resultBuckets.map((rows) => round1(won(rows, false) / designers)) },
    },
    {
      key: "win_rate",
      label: "Win rate",
      unit: "pct",
      better: "higher",
      mine: share(won(input.results, true), decided(input.results, true)),
      studio: share(won(input.results, false), decided(input.results, false)),
      series: { mine: runningRate(true), studio: runningRate(false) },
    },
  ];
  return { kpis, buckets: starts, bucketDays: days, designers, limitMin };
}

// The gap between a designer's number and the studio's, and whether it is good news.
export function delta(kpi: Pick<Kpi, "unit" | "better" | "mine" | "studio">): { text: string; tone: "ok" | "danger" | "neutral"; direction: "up" | "down" | "flat" } | null {
  if (kpi.mine === null || kpi.studio === null) return null;
  const diff = kpi.mine - kpi.studio;
  const direction = Math.abs(diff) < 1e-9 ? "flat" : diff > 0 ? "up" : "down";
  const good = direction === "flat" ? null : (diff > 0) === (kpi.better === "higher");
  const tone = good === null ? "neutral" : good ? "ok" : "danger";
  const size = Math.abs(diff);
  const text =
    kpi.unit === "pct" ? `${Math.round(size * 100)} pp` : kpi.unit === "min" ? `${Math.round(size * 10) / 10} min` : kpi.studio > 0 ? `${Math.round((size / kpi.studio) * 100)}%` : `${Math.round(size * 10) / 10}`;
  return { text, tone, direction };
}
