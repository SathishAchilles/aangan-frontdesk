// Seeds about six weeks of demo calls, enquiries, bookings, handoffs, tasks and costs so the dashboard
// has every scenario to show, or removes them again. Reruns replace the previous demo set. Demo rows
// are shaped so the follow-ups job never acts on them (scripts/demo/constants.ts explains how).
// Usage: npm run seed:demo           (DB_SCHEMA=aangan_test npm run seed:demo for the test schema)
//        npm run seed:demo:remove
import postgres from "postgres";
import { DEMO_TABLES, type DemoCounts, removeDemo, seedDemo } from "./demo/db";

const schema = process.env.DB_SCHEMA === "aangan_test" ? "aangan_test" : "aangan";
const url = process.env.DATABASE_MIGRATION_URL;
if (!url) throw new Error("DATABASE_MIGRATION_URL is not set");
const sql = postgres(url, { max: 1, onnotice: () => {} });

const table = (label: string, counts: DemoCounts) => `${label}: ${DEMO_TABLES.map((name) => `${name}=${counts[name]}`).join(" ")}`;

async function main() {
  if (process.argv.includes("--remove")) {
    const removed = await removeDemo(sql, schema);
    console.log(`${schema}: demo data removed`);
    console.log(table("removed", removed));
    return;
  }
  const { removed, inserted, plan, skippedEvals } = await seedDemo(sql, schema);
  const count = <T>(rows: T[], test: (row: T) => boolean) => rows.filter(test).length;
  const outcomes = Object.entries(plan.enquiries.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.outcome]: (acc[e.outcome] ?? 0) + 1 }), {}))
    .map(([outcome, n]) => `${outcome}=${n}`)
    .join(" ");
  console.log(`${schema}: demo data seeded`);
  console.log(table("removed first", removed));
  console.log(table("inserted", inserted));
  console.log(`outcomes: ${outcomes}`);
  console.log(
    `bookings: upcoming=${count(plan.bookings, (b) => b.start_at > new Date() && b.status !== "cancelled")} cancelled=${count(plan.bookings, (b) => b.status === "cancelled")} rescheduled=${count(plan.bookings, (b) => b.status === "rescheduled")}; won=${count(plan.enquiries, (e) => e.consult_result === "won")} lost=${count(plan.enquiries, (e) => e.consult_result === "lost")}`,
  );
  if (skippedEvals.length > 0) console.log(`eval runs not added (real runs exist): ${skippedEvals.join(", ")}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
