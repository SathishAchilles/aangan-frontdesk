// Eval data-integrity: seeding twice changes nothing, constraints hold, and the app role
// cannot read any other app's schema in the shared Supabase project.
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import type { EvalRunner } from "../registry";
import { buildReport } from "../report";
import type { ItemResult } from "../types";

const SCHEMA = "aangan_test";
const FOREIGN_SCHEMAS = ["trip_together", "kargo_hiring", "auth"];

function seed() {
  execFileSync("npx", ["tsx", "scripts/seed.ts"], {
    env: { ...process.env, DB_SCHEMA: SCHEMA },
    stdio: ["ignore", "ignore", "pipe"],
  });
}

export const dataIntegrity: EvalRunner = async ({ budget }) => {
  const startedAt = new Date();
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) throw new Error("DATABASE_MIGRATION_URL is not set");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const items: ItemResult[] = [];

  try {
    const countRows = async () => {
      const tables = await sql<{ table_name: string }[]>`
        select c.relname as table_name from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = ${SCHEMA} and c.relkind = 'r' and c.relname <> '__migrations'
        order by 1`;
      const result: { table_name: string; rows: number }[] = [];
      for (const { table_name } of tables) {
        const [{ rows }] = await sql<{ rows: number }[]>`select count(*)::int as rows from ${sql(`${SCHEMA}.${table_name}`)}`;
        result.push({ table_name, rows });
      }
      return result;
    };

    seed();
    const first = await countRows();
    seed();
    const second = await countRows();
    const changed = second.filter((row, index) => row.rows !== first[index]?.rows).map((row) => row.table_name);
    items.push({
      item_id: "seed-idempotent",
      expected: "no row count changes",
      actual: changed.length === 0 ? "no changes" : changed,
      scores: { changed_tables: changed.length },
      passed: changed.length === 0,
    });

    const [violations] = await sql<{ fk: number; dup_phone: number; dup_call: number; dup_inbox: number }[]>`
      select
        (select count(*)::int from ${sql(`${SCHEMA}.enquiries`)} e
          left join ${sql(`${SCHEMA}.callers`)} c on c.id = e.caller_id where c.id is null) as fk,
        (select count(*)::int from (select phone_e164 from ${sql(`${SCHEMA}.callers`)} group by 1 having count(*) > 1) d) as dup_phone,
        (select count(*)::int from (select vaani_call_id from ${sql(`${SCHEMA}.calls`)} group by 1 having count(*) > 1) d) as dup_call,
        (select count(*)::int from (select source, external_id from ${sql(`${SCHEMA}.inbox`)} group by 1, 2 having count(*) > 1) d) as dup_inbox`;
    const totalViolations = violations.fk + violations.dup_phone + violations.dup_call + violations.dup_inbox;
    items.push({
      item_id: "constraint-violations",
      expected: 0,
      actual: violations,
      scores: { violations: totalViolations },
      passed: totalViolations === 0,
    });

    // The app role connects with this same URL; every foreign table must be unreadable.
    const foreign = await sql<{ schema: string; table: string }[]>`
      select n.nspname as schema, c.relname as table from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ${sql(FOREIGN_SCHEMAS)} and c.relkind = 'r'
      order by n.nspname, c.relname`;
    const sample = FOREIGN_SCHEMAS.flatMap((schema) => foreign.filter((row) => row.schema === schema).slice(0, 3));
    for (const { schema, table } of sample) {
      let readable = false;
      try {
        await sql.unsafe(`select 1 from "${schema}"."${table}" limit 1`);
        readable = true;
      } catch {
        readable = false;
      }
      items.push({
        item_id: `isolation:${schema}.${table}`,
        expected: "permission denied",
        actual: readable ? "readable" : "permission denied",
        scores: { readable },
        passed: !readable,
      });
    }
  } finally {
    await sql.end();
  }

  const isolationItems = items.filter((item) => item.item_id.startsWith("isolation:"));
  return buildReport({
    evalName: "data-integrity",
    datasetVersion: "seed-v1",
    startedAt,
    metrics: {
      seed_changed_tables: Number(items[0].scores.changed_tables),
      constraint_violations: Number(items[1].scores.violations),
      cross_schema_reads: isolationItems.filter((item) => !item.passed).length,
      isolation_checks: isolationItems.length,
    },
    thresholds: [
      { metric: "seed_changed_tables", op: "==", value: 0, hard: true },
      { metric: "constraint_violations", op: "==", value: 0, hard: true },
      { metric: "cross_schema_reads", op: "==", value: 0, hard: true },
      { metric: "isolation_checks", op: ">=", value: 6 },
    ],
    items,
    costInr: budget.spentInr,
  });
};
