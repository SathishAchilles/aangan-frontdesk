import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { costs, designers, overview, parseRange } from "../../src/lib/dashboard/metrics";
import { FIXTURE_EXPECTED, FIXTURE_RANGE, seedDashboardMonth } from "../../src/evals/fixtures/dashboard-month";
import { rebuildTestSchema, seedTestSchema, TEST_SCHEMA, testSql } from "./helpers";

const sql = testSql();
const SETTINGS = { officeStart: "10:00", officeEnd: "19:00", officeDays: ["mon", "tue", "wed", "thu", "fri"], avgProjectValueInr: 1100000 };

beforeAll(async () => {
  rebuildTestSchema();
  seedTestSchema();
  await seedDashboardMonth(sql, TEST_SCHEMA);
}, 300_000);

afterAll(async () => {
  await sql.end();
});

describe("dashboard metrics on the fixture month", () => {
  it("counts calls, after-hours share and outcomes", async () => {
    const data = await overview(sql, TEST_SCHEMA, FIXTURE_RANGE, SETTINGS);
    expect(data.calls).toBe(FIXTURE_EXPECTED.calls);
    expect(data.after_hours_calls).toBe(FIXTURE_EXPECTED.after_hours_calls);
    expect(data.after_hours_share).toBeCloseTo(0.3);
    expect(data.enquiries).toBe(FIXTURE_EXPECTED.enquiries);
    expect((data.outcomes.QUALIFIED ?? 0) + (data.outcomes.QUALIFIED_WITH_NOTES ?? 0)).toBe(FIXTURE_EXPECTED.qualified);
    expect(data.top_failing_criterion).toEqual({ id: FIXTURE_EXPECTED.top_failing, count: 6 });
  });

  it("builds the funnel, pipeline value, callbacks and acceptance", async () => {
    const data = await overview(sql, TEST_SCHEMA, FIXTURE_RANGE, SETTINGS);
    expect({ booked: data.booked, consulted: data.consulted, won: data.won, lost: data.lost }).toEqual({
      booked: FIXTURE_EXPECTED.booked,
      consulted: FIXTURE_EXPECTED.consulted,
      won: FIXTURE_EXPECTED.won,
      lost: FIXTURE_EXPECTED.lost,
    });
    expect(data.pipeline_value_inr).toBe(12 * 1100000);
    expect([data.callbacks_on_time, data.callbacks_total]).toEqual([FIXTURE_EXPECTED.callbacks_on_time, FIXTURE_EXPECTED.callbacks_total]);
    expect(data.handoffs_posted).toBe(FIXTURE_EXPECTED.handoffs_posted);
    expect(data.escalations).toBe(FIXTURE_EXPECTED.escalations);
    expect(data.median_accept_minutes).toBe(10);
  });

  it("computes costs, including the spec example (80 qualified leads, Rs 8,000 -> Rs 100)", async () => {
    const cost = await costs(sql, TEST_SCHEMA, FIXTURE_RANGE, { calls: 100, qualified: 80, booked: 40, won: 12 });
    expect(cost.total_inr).toBe(FIXTURE_EXPECTED.total_cost);
    expect(cost.per_qualified_lead).toBe(FIXTURE_EXPECTED.per_qualified_lead);
    expect(cost.per_call).toBe(FIXTURE_EXPECTED.per_call);
    expect(cost.per_booking).toBe(FIXTURE_EXPECTED.per_booking);
    expect(cost.by_kind).toEqual({ agent_min: 6000 });
  });

  it("splits work per designer and adds up to the totals", async () => {
    const rows = await designers(sql, TEST_SCHEMA, FIXTURE_RANGE);
    expect(rows.reduce((sum, row) => sum + row.won, 0)).toBe(FIXTURE_EXPECTED.won);
    expect(rows.reduce((sum, row) => sum + row.escalations, 0)).toBe(FIXTURE_EXPECTED.escalations);
    expect(rows.every((row) => row.assigned > 0)).toBe(true);
  });

  it("returns zeros for an empty range", async () => {
    const data = await overview(sql, TEST_SCHEMA, { from: "2025-01-01", to: "2025-02-01" }, SETTINGS);
    expect(data.calls).toBe(0);
    expect(data.median_accept_minutes).toBeNull();
  });
});

describe("parseRange", () => {
  it("accepts valid dates and falls back to the current month", () => {
    expect(parseRange({ from: "2026-09-01", to: "2026-10-01" })).toEqual(FIXTURE_RANGE);
    expect(parseRange({ from: "bad" }, new Date("2026-10-11T06:00:00Z"))).toEqual({ from: "2026-10-01", to: "2026-11-01" });
  });
});
