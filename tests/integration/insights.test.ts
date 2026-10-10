import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURE_EXPECTED, FIXTURE_RANGE, seedDashboardMonth } from "../../src/evals/fixtures/dashboard-month";
import { insights } from "../../src/lib/dashboard/insights";
import { costs, designers, overview } from "../../src/lib/dashboard/metrics";
import { rebuildTestSchema, seedTestSchema, TEST_SCHEMA, testSql } from "./helpers";

const sql = testSql();
const t = (name: string) => sql(`${TEST_SCHEMA}.${name}`);
const SETTINGS = { officeStart: "10:00", officeEnd: "19:00", officeDays: ["mon", "tue", "wed", "thu", "fri"], avgProjectValueInr: 1100000 };

// A week in March 2026 compared with the week before it. Far from the fixture month (September).
const WEEK = { from: "2026-03-08", to: "2026-03-15" };
// Friday 20 March 2026, 15:00 IST.
const NOW = new Date("2026-03-20T15:00:00+05:30");

let seq = 0;
let designerId: string | null = null;

// One caller, one enquiry and one inbound call at `at` (an ISO time with offset).
async function lead(at: string, outcome: string, opts: { name?: string | null; booking?: { start: string; end?: string; status?: string; type?: string }; won?: boolean; locality?: string } = {}) {
  seq += 1;
  const phone = `+9198123${String(seq).padStart(5, "0")}`;
  const name = opts.name === undefined ? `Insight ${seq}` : opts.name;
  const [caller] = await sql<{ id: string }[]>`insert into ${t("callers")} (phone_e164, name) values (${phone}, ${name}) returning id`;
  const [enquiry] = await sql<{ id: string }[]>`
    insert into ${t("enquiries")} (caller_id, outcome, facts, assigned_designer_id, consult_result, created_at, updated_at)
    values (${caller.id}, ${outcome}, ${sql.json(opts.locality ? { locality: opts.locality } : {})}, ${designerId}, ${opts.won ? "won" : null}, ${at}, ${at}) returning id`;
  await sql`insert into ${t("calls")} (vaani_call_id, enquiry_id, caller_id, direction, started_at, ended_at, duration_s, created_at)
            values (${`insight-${seq}`}, ${enquiry.id}, ${caller.id}, 'in', ${at}, ${at}, 180, ${at})`;
  if (opts.booking) {
    await sql`insert into ${t("bookings")} (enquiry_id, calcom_uid, consult_type, start_at, end_at, designer_id, status, created_at)
              values (${enquiry.id}, ${`insight-booking-${seq}`}, ${opts.booking.type ?? "studio"}, ${opts.booking.start}, ${opts.booking.end ?? null}, ${designerId}, ${opts.booking.status ?? "booked"}, ${at})`;
  }
  return { phone, enquiryId: enquiry.id };
}

let unnamedPhone = "";

beforeAll(async () => {
  rebuildTestSchema();
  seedTestSchema();
  await seedDashboardMonth(sql, TEST_SCHEMA);
  const [designer] = await sql<{ id: string }[]>`select id from ${t("staff")} where role = 'designer' order by name limit 1`;
  designerId = designer?.id ?? null;
  const held = { start: "2026-03-16T11:00:00+05:30" };

  // Prior week (1-7 March): 4 calls, 4 enquiries, 2 qualified, 1 booked.
  await lead("2026-02-28T23:59:00+05:30", "QUALIFIED"); // the day before the prior week: in neither period
  await lead("2026-03-02T11:00:00+05:30", "QUALIFIED", { booking: held });
  await lead("2026-03-03T11:00:00+05:30", "QUALIFIED");
  await lead("2026-03-05T11:00:00+05:30", "NOT_QUALIFIED");
  await lead("2026-03-07T23:59:00+05:30", "NOT_ENQUIRY"); // last minute of the prior week (18:29 UTC)

  // This week (8-14 March): 6 calls, 6 enquiries, 4 qualified, 3 booked (a cancelled booking does not count), 1 won.
  await lead("2026-03-08T00:00:00+05:30", "QUALIFIED", { booking: held, won: true }); // first minute of the week (7 March UTC)
  await lead("2026-03-09T12:00:00+05:30", "QUALIFIED_WITH_NOTES", { booking: held });
  await lead("2026-03-10T12:00:00+05:30", "QUALIFIED", { booking: held });
  await lead("2026-03-12T12:00:00+05:30", "NOT_QUALIFIED", { booking: { ...held, status: "cancelled" } });
  await lead("2026-03-14T10:00:00+05:30", "NEEDS_HUMAN");
  await lead("2026-03-14T23:59:00+05:30", "QUALIFIED");
  await lead("2026-03-15T00:00:00+05:30", "QUALIFIED"); // first minute after the week: excluded

  // Around NOW: consultations today and tomorrow, and the latest calls.
  await lead("2026-03-18T12:00:00+05:30", "QUALIFIED", { booking: { start: "2026-03-20T10:00:00+05:30", end: "2026-03-20T11:00:00+05:30" } }); // already over
  await lead("2026-03-18T13:00:00+05:30", "QUALIFIED", { booking: { start: "2026-03-20T16:00:00+05:30", type: "site" }, locality: "Baner" });
  await lead("2026-03-19T12:00:00+05:30", "QUALIFIED", { booking: { start: "2026-03-21T11:30:00+05:30", status: "rescheduled", type: "principal" } });
  await lead("2026-03-19T13:00:00+05:30", "QUALIFIED", { booking: { start: "2026-03-21T12:00:00+05:30", status: "cancelled" } });
  await lead("2026-03-19T14:00:00+05:30", "QUALIFIED", { booking: { start: "2026-03-22T11:00:00+05:30" } }); // the day after tomorrow
  await lead("2026-03-20T09:00:00+05:30", "QUALIFIED");
  unnamedPhone = (await lead("2026-03-20T14:30:00+05:30", "NOT_QUALIFIED", { name: null })).phone;
  await lead("2026-03-20T15:30:00+05:30", "QUALIFIED"); // after NOW: not a recent call yet
}, 300_000);

afterAll(async () => {
  await sql.end();
});

describe("overview insights: period comparison", () => {
  it("compares the range with the period of equal length just before it", async () => {
    const data = await insights(sql, TEST_SCHEMA, WEEK, SETTINGS, NOW);
    expect(data.prior).toEqual({ from: "2026-03-01", to: "2026-03-08" });
    expect(data.days).toBe(7);
    expect(data.kpis.calls).toEqual({ current: 6, prior: 4, change_pct: 50 });
    expect(data.kpis.booked).toEqual({ current: 3, prior: 1, change_pct: 200 });
    expect(data.kpis.qualification_rate.current).toBeCloseTo(4 / 6);
    expect(data.kpis.qualification_rate.prior).toBeCloseTo(2 / 4);
    expect(data.kpis.qualification_rate.change_pp).toBeCloseTo((4 / 6 - 0.5) * 100);
  });

  it("reports the same totals as metrics.overview for both periods", async () => {
    const data = await insights(sql, TEST_SCHEMA, WEEK, SETTINGS, NOW);
    const current = await overview(sql, TEST_SCHEMA, WEEK, SETTINGS);
    const prior = await overview(sql, TEST_SCHEMA, data.prior, SETTINGS);
    expect(data.current).toEqual(current);
    expect(data.previous).toEqual(prior);
    expect(data.kpis.calls.prior).toBe(prior.calls);
    expect(data.kpis.booked.current).toBe(current.booked);
  });

  it("buckets days on IST boundaries and the daily series add up to the totals", async () => {
    const data = await insights(sql, TEST_SCHEMA, WEEK, SETTINGS, NOW);
    const days = (series: typeof data.series.current) => series.map((d) => d.day);
    expect(days(data.series.current)).toEqual(["2026-03-08", "2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12", "2026-03-13", "2026-03-14"]);
    expect(days(data.series.prior)).toEqual(["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07"]);
    expect(data.series.current[0]).toEqual({ day: "2026-03-08", calls: 1, enquiries: 1, qualified: 1, booked: 1 });
    expect(data.series.current[6]).toEqual({ day: "2026-03-14", calls: 2, enquiries: 2, qualified: 1, booked: 0 });
    expect(data.series.current[3]).toEqual({ day: "2026-03-11", calls: 0, enquiries: 0, qualified: 0, booked: 0 });
    expect(data.series.prior[6]).toEqual({ day: "2026-03-07", calls: 1, enquiries: 1, qualified: 0, booked: 0 });
    for (const [series, totals] of [
      [data.series.current, data.current],
      [data.series.prior, data.previous],
    ] as const) {
      const sum = (key: "calls" | "enquiries" | "qualified" | "booked") => series.reduce((acc, d) => acc + d[key], 0);
      expect(sum("calls")).toBe(totals.calls);
      expect(sum("enquiries")).toBe(totals.enquiries);
      expect(sum("qualified")).toBe((totals.outcomes.QUALIFIED ?? 0) + (totals.outcomes.QUALIFIED_WITH_NOTES ?? 0));
      expect(sum("booked")).toBe(totals.booked);
    }
  });

  it("builds the funnel with shares and step rates", async () => {
    const data = await insights(sql, TEST_SCHEMA, WEEK, SETTINGS, NOW);
    expect(data.funnel.map((step) => [step.stage, step.value])).toEqual([
      ["enquiries", 6],
      ["qualified", 4],
      ["booked", 3],
      ["consulted", 3],
      ["won", 1],
    ]);
    expect(data.funnel.map((step) => step.step_rate)).toEqual([null, 4 / 6, 3 / 4, 1, 1 / 3]);
    expect(data.funnel.map((step) => step.share)).toEqual([1, 4 / 6, 3 / 6, 3 / 6, 1 / 6]);
    expect(data.outcomes).toEqual([
      { outcome: "QUALIFIED", n: 3 },
      { outcome: "QUALIFIED_WITH_NOTES", n: 1 },
      { outcome: "NOT_QUALIFIED", n: 1 },
      { outcome: "NEEDS_HUMAN", n: 1 },
    ]);
  });

  it("returns zeros, empty days and no changes for an empty range", async () => {
    const data = await insights(sql, TEST_SCHEMA, { from: "2025-01-01", to: "2025-01-15" }, SETTINGS, NOW);
    expect(data.kpis.calls).toEqual({ current: 0, prior: 0, change_pct: null });
    expect(data.kpis.booked.change_pct).toBeNull();
    expect(data.kpis.qualification_rate).toEqual({ current: null, prior: null, change_pp: null });
    expect(data.series.current).toHaveLength(14);
    expect(data.series.current.every((d) => d.calls + d.enquiries + d.qualified + d.booked === 0)).toBe(true);
    expect(data.funnel.every((step) => step.value === 0 && step.share === null && step.step_rate === null)).toBe(true);
    expect(data.outcomes).toEqual([]);
    expect(data.designer_insight).toBeNull();
    expect(data.cost.per_qualified_lead).toBeNull();
  });
});

describe("overview insights on the fixture month", () => {
  it("agrees with metrics.ts and the fixture's known answers", async () => {
    const data = await insights(sql, TEST_SCHEMA, FIXTURE_RANGE, SETTINGS, NOW);
    expect(data.kpis.calls.current).toBe(FIXTURE_EXPECTED.calls);
    expect(data.qualified.current).toBe(FIXTURE_EXPECTED.qualified);
    expect(data.kpis.booked.current).toBe(FIXTURE_EXPECTED.booked);
    expect(data.kpis.qualification_rate.current).toBeCloseTo(FIXTURE_EXPECTED.qualified / FIXTURE_EXPECTED.enquiries);
    expect(data.prior).toEqual({ from: "2026-08-02", to: "2026-09-01" });
    expect(data.kpis.calls.change_pct).toBeNull();
    expect(data.cost.total_inr).toBe(FIXTURE_EXPECTED.total_cost);
    expect(data.cost.per_qualified_lead).toBe(FIXTURE_EXPECTED.per_qualified_lead);
    expect(data.cost).toEqual(await costs(sql, TEST_SCHEMA, FIXTURE_RANGE, { calls: 100, qualified: 80, booked: 40, won: 12 }));
    expect(data.designers).toEqual(await designers(sql, TEST_SCHEMA, FIXTURE_RANGE));
    expect(data.funnel.map((step) => step.value)).toEqual([100, 80, 40, 30, 12]);
    expect(data.funnel.map((step) => step.step_rate)).toEqual([null, 0.8, 0.5, 0.75, 0.4]);
    expect(data.series.current).toHaveLength(30);
    expect(data.series.current.reduce((acc, d) => acc + d.calls, 0)).toBe(FIXTURE_EXPECTED.calls);
    expect(data.series.current.reduce((acc, d) => acc + d.booked, 0)).toBe(FIXTURE_EXPECTED.booked);
  });
});

describe("overview insights: today, upcoming and recent calls", () => {
  it("counts today in IST and lists consultations still to come today and tomorrow", async () => {
    const data = await insights(sql, TEST_SCHEMA, WEEK, SETTINGS, NOW);
    // today() counts the whole IST day, so the 15:30 row (after NOW) is in it too.
    expect(data.today).toEqual({ calls: 3, qualified: 2, consults: 2 });
    expect(data.upcoming.map((u) => [u.day, u.consult_type, u.status, u.locality])).toEqual([
      ["today", "site", "booked", "Baner"],
      ["tomorrow", "principal", "rescheduled", null],
    ]);
  });

  it("returns the latest calls up to now, oldest first, with phone numbers masked", async () => {
    const data = await insights(sql, TEST_SCHEMA, WEEK, SETTINGS, NOW);
    expect(data.recent).toHaveLength(12);
    const times = data.recent.map((call) => call.at.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    const last = data.recent[data.recent.length - 1];
    expect(last.at.toISOString()).toBe(new Date("2026-03-20T14:30:00+05:30").toISOString());
    expect(last.outcome).toBe("NOT_QUALIFIED");
    expect(last.caller).toBe(`+91 ••••• •${unnamedPhone.slice(-4)}`);
    expect(JSON.stringify(data)).not.toMatch(/\+91\d{10}/);
  });
});
