// Writes and removes the demo data set. Demo rows are found only by their markers (constants.ts):
// callers in the reserved phone block and the enquiries that belong to them, `demo-` call and
// booking ids, "Demo · " fixed-cost items and the demo eval commit. Settings, staff, localities,
// festival dates and every other row are read at most, never written.
import type postgres from "postgres";
import type { DayKey } from "../../src/lib/rules/time";
import { DEMO_EVAL_COMMIT, DEMO_FIXED_COST_PREFIX, DEMO_ID_PREFIX, DEMO_PHONE_BLOCK } from "./constants";
import { buildDemoPlan, type DemoInputs, type DemoPlan } from "./plan";

export const DEMO_TABLES = ["callers", "enquiries", "calls", "bookings", "handoffs", "tasks", "cost_lines", "fixed_costs", "eval_runs"] as const;
export type DemoCounts = Record<(typeof DEMO_TABLES)[number], number>;

type Sql = postgres.Sql | postgres.TransactionSql;

const JSON_COLUMNS = new Set(["criteria", "facts", "grader_flags", "note", "payload", "metrics", "thresholds"]);
const BLOCK = `${DEMO_PHONE_BLOCK}%`;
const DEMO_ID = `${DEMO_ID_PREFIX}%`;
const FIXED_ITEM = `${DEMO_FIXED_COST_PREFIX}%`;

function tables(sql: Sql, schema: string) {
  if (schema !== "aangan" && schema !== "aangan_test") throw new Error(`Unknown schema ${schema}`);
  return (name: string) => sql(`${schema}.${name}`);
}

export async function demoCounts(sql: Sql, schema: string): Promise<DemoCounts> {
  const t = tables(sql, schema);
  const [row] = await sql<DemoCounts[]>`
    with dc as (select id from ${t("callers")} where phone_e164 like ${BLOCK}),
         de as (select id from ${t("enquiries")} where caller_id in (select id from dc))
    select (select count(*) from dc)::int as callers,
           (select count(*) from de)::int as enquiries,
           (select count(*) from ${t("calls")} where vaani_call_id like ${DEMO_ID})::int as calls,
           (select count(*) from ${t("bookings")} where calcom_uid like ${DEMO_ID})::int as bookings,
           (select count(*) from ${t("handoffs")} where enquiry_id in (select id from de))::int as handoffs,
           (select count(*) from ${t("tasks")} where enquiry_id in (select id from de))::int as tasks,
           (select count(*) from ${t("cost_lines")} where call_id in (select id from ${t("calls")} where vaani_call_id like ${DEMO_ID}))::int as cost_lines,
           (select count(*) from ${t("fixed_costs")} where item like ${FIXED_ITEM})::int as fixed_costs,
           (select count(*) from ${t("eval_runs")} where commit_sha = ${DEMO_EVAL_COMMIT})::int as eval_runs`;
  return row;
}

// Refuses to go on if anything outside the demo set has attached itself to a demo caller or enquiry
// (a real call from a number in the block, a Cal.com booking, a CRM sync). Those need a person.
async function assertDemoSetIsSelfContained(sql: Sql, schema: string) {
  const t = tables(sql, schema);
  const [row] = await sql<{ calls: number; bookings: number; synced: number }[]>`
    with dc as (select id from ${t("callers")} where phone_e164 like ${BLOCK}),
         de as (select id from ${t("enquiries")} where caller_id in (select id from dc))
    select (select count(*) from ${t("calls")} where (caller_id in (select id from dc) or enquiry_id in (select id from de)) and vaani_call_id not like ${DEMO_ID})::int as calls,
           (select count(*) from ${t("bookings")} where enquiry_id in (select id from de) and calcom_uid not like ${DEMO_ID})::int as bookings,
           ((select count(*) from ${t("crm_links")} where enquiry_id in (select id from de))
             + (select count(*) from ${t("enquiries")} where id in (select id from de) and 'sync_pending' = any(flags)))::int as synced`;
  if (row.calls + row.bookings + row.synced > 0) {
    throw new Error(
      `Refusing to touch the demo block in ${schema}: ${row.calls} non-demo calls, ${row.bookings} non-demo bookings and ${row.synced} CRM-linked or sync-pending enquiries are attached to ${DEMO_PHONE_BLOCK}xxxx. Investigate before removing anything.`,
    );
  }
}

async function deleteDemo(sql: Sql, schema: string) {
  const t = tables(sql, schema);
  const demoCalls = sql`select id from ${t("calls")} where vaani_call_id like ${DEMO_ID}`;
  const demoEnquiries = sql`select id from ${t("enquiries")} where caller_id in (select id from ${t("callers")} where phone_e164 like ${BLOCK})`;
  await sql`delete from ${t("cost_lines")} where call_id in (${demoCalls}) or enquiry_id in (${demoEnquiries})`;
  await sql`delete from ${t("handoffs")} where enquiry_id in (${demoEnquiries})`;
  await sql`delete from ${t("tasks")} where enquiry_id in (${demoEnquiries})`;
  await sql`delete from ${t("bookings")} where enquiry_id in (${demoEnquiries}) and calcom_uid like ${DEMO_ID}`;
  await sql`delete from ${t("calls")} where vaani_call_id like ${DEMO_ID}`;
  await sql`delete from ${t("enquiries")} where id in (${demoEnquiries})`;
  await sql`delete from ${t("callers")} where phone_e164 like ${BLOCK}`;
  await sql`delete from ${t("fixed_costs")} where item like ${FIXED_ITEM}`;
  await sql`delete from ${t("eval_runs")} where commit_sha = ${DEMO_EVAL_COMMIT}`;
}

export async function removeDemo(sql: postgres.Sql, schema: string): Promise<DemoCounts> {
  return sql.begin(async (tx) => {
    await assertDemoSetIsSelfContained(tx, schema);
    const before = await demoCounts(tx, schema);
    await deleteDemo(tx, schema);
    const after = await demoCounts(tx, schema);
    if (Object.values(after).some((n) => n !== 0)) throw new Error(`Demo rows left after removal: ${JSON.stringify(after)}`);
    return before;
  }) as Promise<DemoCounts>;
}

export async function loadInputs(sql: Sql, schema: string, now: Date): Promise<DemoInputs> {
  const t = tables(sql, schema);
  const rows = await sql<{ key: string; value: unknown }[]>`select key, value from ${t("settings")}`;
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value])) as Record<string, unknown>;
  const need = <T>(key: string): T => {
    if (!(key in values)) throw new Error(`Setting ${key} is missing in ${schema}; run npm run seed first`);
    return values[key] as T;
  };
  const designers = await sql<{ id: string; name: string; consult_types: string[] }[]>`
    select id, name, consult_types from ${t("staff")} where role = 'designer' and active order by name`;
  const [frontDesk] = await sql<{ id: string }[]>`select id from ${t("staff")} where role = 'front_desk' and active order by name limit 1`;
  const hours = need<{ start: string; end: string }>("office_hours");
  const ai = need<{ input: number; output: number }>("cost_ai_usd_per_m");
  const inrPerUsd = Number(need("inr_per_usd"));
  return {
    now,
    designers: designers.map((d) => ({ id: d.id, name: d.name, consultTypes: d.consult_types })),
    frontDeskId: frontDesk?.id ?? null,
    office: { start: hours.start, end: hours.end, days: need<DayKey[]>("office_days") },
    prices: {
      agentPerMin: Number(need("cost_agent_inr_per_min")),
      telephonyPerMin: Number(need("cost_telephony_inr_per_min")),
      aiInPerTok: (ai.input * inrPerUsd) / 1_000_000,
      aiOutPerTok: (ai.output * inrPerUsd) / 1_000_000,
    },
    transcriptDays: Number(need("retention_transcript_days")),
    acceptReminderMin: Number(need("accept_reminder_min")),
    acceptEscalateMin: Number(need("accept_escalate_min")),
    callbackWithinMin: Number(need("callback_within_min")),
    afterHoursCallbackTime: String(need("after_hours_callback_time")),
  };
}

async function insertRows(sql: Sql, schema: string, table: string, rows: object[]) {
  if (rows.length === 0) return;
  const t = tables(sql, schema);
  const prepared = rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, JSON_COLUMNS.has(key) ? sql.json(value as never) : value])));
  const columns = Object.keys(rows[0]);
  for (let i = 0; i < prepared.length; i += 200) {
    await sql`insert into ${t(table)} ${sql(prepared.slice(i, i + 200) as never, columns)}`;
  }
}

export type SeedResult = { removed: DemoCounts; inserted: DemoCounts; plan: DemoPlan; skippedEvals: string[] };

// Remove-then-insert in one transaction: the follow-ups job never sees a partly written set, and a
// rerun replaces the previous demo set instead of adding to it.
export async function seedDemo(sql: postgres.Sql, schema: string, now = new Date()): Promise<SeedResult> {
  return sql.begin(async (tx) => {
    await assertDemoSetIsSelfContained(tx, schema);
    const removed = await demoCounts(tx, schema);
    await deleteDemo(tx, schema);
    const plan = buildDemoPlan(await loadInputs(tx, schema, now));
    const t = tables(tx, schema);

    await insertRows(tx, schema, "callers", plan.callers);
    await insertRows(tx, schema, "enquiries", plan.enquiries);
    await insertRows(tx, schema, "calls", plan.calls);
    await insertRows(tx, schema, "bookings", plan.bookings);
    await insertRows(tx, schema, "handoffs", plan.handoffs);
    await insertRows(tx, schema, "tasks", plan.tasks);
    await insertRows(tx, schema, "cost_lines", plan.cost_lines);
    for (const cost of plan.fixed_costs) {
      await tx`insert into ${t("fixed_costs")} (month, item, amount_inr) values (${cost.month}, ${cost.item}, ${cost.amount_inr}) on conflict (month, item) do nothing`;
    }
    // Demo eval runs only for evals that have never really run, so they never hide a real result.
    const real = new Set((await tx<{ eval_name: string }[]>`select distinct eval_name from ${t("eval_runs")} where commit_sha <> ${DEMO_EVAL_COMMIT}`).map((row) => row.eval_name));
    const skippedEvals = [...new Set(plan.eval_runs.filter((run) => real.has(run.eval_name)).map((run) => run.eval_name))];
    await insertRows(tx, schema, "eval_runs", plan.eval_runs.filter((run) => !real.has(run.eval_name)));

    const inserted = await demoCounts(tx, schema);
    return { removed, inserted, plan, skippedEvals };
  }) as Promise<SeedResult>;
}
