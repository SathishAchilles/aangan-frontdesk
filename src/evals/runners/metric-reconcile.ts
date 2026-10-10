// Eval metric-reconcile: every dashboard figure for the fixture month, recomputed with SQL written
// independently of src/lib/dashboard/metrics.ts. All figures must be equal.
import postgres from "postgres";
import { costs, overview } from "../../lib/dashboard/metrics";
import { FIXTURE_RANGE, seedDashboardMonth } from "../fixtures/dashboard-month";
import type { EvalRunner } from "../registry";
import { buildReport } from "../report";
import type { ItemResult } from "../types";

const SCHEMA = "aangan_test";

export const metricReconcile: EvalRunner = async ({ budget }) => {
  const startedAt = new Date();
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) throw new Error("DATABASE_MIGRATION_URL is not set");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const items: ItemResult[] = [];
  try {
    await seedDashboardMonth(sql, SCHEMA);
    const settings = { officeStart: "10:00", officeEnd: "19:00", officeDays: ["mon", "tue", "wed", "thu", "fri"], avgProjectValueInr: 1100000 };
    const dashboard = await overview(sql, SCHEMA, FIXTURE_RANGE, settings);
    const qualified = (dashboard.outcomes.QUALIFIED ?? 0) + (dashboard.outcomes.QUALIFIED_WITH_NOTES ?? 0);
    const cost = await costs(sql, SCHEMA, FIXTURE_RANGE, { calls: dashboard.calls, qualified, booked: dashboard.booked, won: dashboard.won });

    // Independent formulations: subqueries per figure, IST via explicit offsets, no shared helpers.
    const q = (text: string) => sql.unsafe<{ v: number }[]>(text.replaceAll("S.", `"${SCHEMA}".`)).then((rows) => Number(rows[0]?.v ?? 0));
    const from = "timestamptz '2026-09-01 00:00+05:30'";
    const to = "timestamptz '2026-10-01 00:00+05:30'";
    const independent: Record<string, number> = {
      calls: await q(`select count(*) v from S.calls where started_at >= ${from} and started_at < ${to}`),
      after_hours_calls: await q(`select count(*) v from S.calls where direction = 'in' and started_at >= ${from} and started_at < ${to}
        and not (extract(isodow from started_at + interval '5 hours 30 minutes') between 1 and 5
                 and (started_at + interval '5 hours 30 minutes')::time >= time '10:00'
                 and (started_at + interval '5 hours 30 minutes')::time < time '19:00')`),
      qualified: await q(`select count(*) v from S.enquiries where outcome in ('QUALIFIED','QUALIFIED_WITH_NOTES') and created_at >= ${from} and created_at < ${to}`),
      booked: await q(`select count(*) v from S.enquiries e where created_at >= ${from} and created_at < ${to} and exists (select 1 from S.bookings b where b.enquiry_id = e.id and b.status <> 'cancelled')`),
      consulted: await q(`select count(*) v from S.enquiries e where created_at >= ${from} and created_at < ${to} and exists (select 1 from S.bookings b where b.enquiry_id = e.id and b.status <> 'cancelled' and b.start_at < now())`),
      won: await q(`select count(*) v from S.enquiries where consult_result = 'won' and created_at >= ${from} and created_at < ${to}`),
      lost: await q(`select count(*) v from S.enquiries where consult_result = 'lost' and created_at >= ${from} and created_at < ${to}`),
      callbacks_total: await q(`select count(*) v from S.tasks where kind = 'callback' and created_at >= ${from} and created_at < ${to}`),
      callbacks_on_time: await q(`select count(*) v from S.tasks where kind = 'callback' and created_at >= ${from} and created_at < ${to} and done_at <= due_at`),
      handoffs_posted: await q(`select count(*) v from S.handoffs where posted_at >= ${from} and posted_at < ${to}`),
      escalations: await q(`select count(*) v from S.handoffs where escalated_at is not null and posted_at >= ${from} and posted_at < ${to}`),
      total_cost: await q(`select (select coalesce(sum(amount_inr),0) from S.cost_lines where recorded_at >= ${from} and recorded_at < ${to}) + (select coalesce(sum(amount_inr),0) from S.fixed_costs where month = date '2026-09-01') v`),
    };
    independent.per_qualified_lead = Math.round((independent.total_cost / independent.qualified) * 100) / 100;
    independent.per_call = Math.round((independent.total_cost / independent.calls) * 100) / 100;

    const shown: Record<string, number | null> = {
      calls: dashboard.calls,
      after_hours_calls: dashboard.after_hours_calls,
      qualified,
      booked: dashboard.booked,
      consulted: dashboard.consulted,
      won: dashboard.won,
      lost: dashboard.lost,
      callbacks_total: dashboard.callbacks_total,
      callbacks_on_time: dashboard.callbacks_on_time,
      handoffs_posted: dashboard.handoffs_posted,
      escalations: dashboard.escalations,
      total_cost: cost.total_inr,
      per_qualified_lead: cost.per_qualified_lead,
      per_call: cost.per_call,
    };
    for (const [key, expected] of Object.entries(independent)) {
      const actual = shown[key];
      items.push({ item_id: key, expected, actual, scores: { equal: Number(actual) === expected }, passed: Number(actual) === expected });
    }
  } finally {
    await sql.end();
  }
  const mismatches = items.filter((item) => !item.passed).length;
  return buildReport({
    evalName: "metric-reconcile",
    datasetVersion: "fixture-2026-09",
    startedAt,
    metrics: { figures: items.length, mismatches },
    thresholds: [{ metric: "mismatches", op: "==", value: 0, hard: true }],
    items,
    costInr: budget.spentInr,
  });
};
