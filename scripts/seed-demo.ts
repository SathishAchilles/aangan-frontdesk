// Seeds about six weeks of demo calls, enquiries, bookings, handoffs, tasks and costs so the dashboards
// have every scenario to show, or removes them again. Reruns replace the previous demo set. Demo rows
// are shaped so the follow-ups job never acts on them (scripts/demo/constants.ts explains how).
// Usage: npm run seed:demo           (DB_SCHEMA=aangan_test npm run seed:demo for the test schema)
//        npm run seed:demo:remove
import postgres from "postgres";
import { DEMO_TABLES, type DemoCounts, removeDemo, seedDemo } from "./demo/db";
import { demoWeeks } from "./demo/plan";

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
  const tally = (values: string[]) =>
    Object.entries(values.reduce<Record<string, number>>((acc, value) => ({ ...acc, [value]: (acc[value] ?? 0) + 1 }), {}))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, n]) => `${key}=${n}`)
      .join(" ");
  const now = new Date();
  const ist = (date: Date) => new Date(date.getTime() + 330 * 60_000);
  const istDay = (date: Date) => ist(date).toISOString().slice(0, 10);
  const today = istDay(now);
  const tomorrow = istDay(new Date(now.getTime() + 86_400_000));
  const inbound = plan.calls.filter((c) => c.direction === "in");
  const weekend = (date: Date) => [0, 6].includes(ist(date).getUTCDay());
  const afterHours = (date: Date) => weekend(date) || ist(date).getUTCHours() < 10 || ist(date).getUTCHours() >= 19;
  const perCaller = tally(plan.calls.map((c) => c.caller_id)).split(" ").filter((entry) => Number(entry.split("=")[1]) > 1).length;
  console.log(`handoffs: ${tally(plan.handoffs.map((h) => (!h.accepted_at ? "escalated_unaccepted" : h.escalated_at ? "escalated_then_accepted" : h.reminded_at ? "slow" : "fast")))}`);
  console.log(`not qualified by failing criterion: ${tally(plan.enquiries.flatMap((e) => e.criteria.filter((c) => c.state === "fail").map((c) => c.id)))}; service reasons: ${tally(plan.enquiries.filter((e) => e.outcome === "NOT_QUALIFIED" && !e.criteria.some((c) => c.state === "fail")).map((e) => String(e.facts.work_type ?? e.facts.property_kind ?? e.facts.scope_text)))}`);
  console.log(`tasks: ${tally(plan.tasks.map((t) => t.kind))}`);
  console.log(`calls: inbound=${inbound.length} after_hours=${inbound.filter((c) => afterHours(c.started_at)).length} weekend=${inbound.filter((c) => weekend(c.started_at)).length} dropped=${count(plan.calls, (c) => c.dropped)} outbound_callbacks=${count(plan.calls, (c) => c.direction === "out")} safety_flagged=${count(plan.calls, (c) => c.grader_flags.price_figure.length + c.grader_flags.budget_question.length > 0)} repeat_callers=${perCaller} today=${count(inbound, (c) => istDay(c.started_at) === today)}`);
  console.log(`bookings by type/status/time: ${tally(plan.bookings.map((b) => `${b.consult_type}/${b.status}/${b.start_at > now ? "future" : "past"}`))}`);
  const names = new Map<string, string>();
  for (const row of await sql<{ id: string; name: string }[]>`select id, name from ${sql(`${schema}.staff`)}`) names.set(row.id, row.name);
  const dayStart = (daysAgo: number) => new Date(`${istDay(new Date(now.getTime() - daysAgo * 86_400_000))}T00:00:00+05:30`);
  const between = (from: Date, to: Date) => count(inbound, (c) => c.started_at >= from && c.started_at < to);
  console.log(`inbound calls: last 14 days incl. today=${between(dayStart(13), now)} prior 14=${between(dayStart(27), dayStart(13))}; 14 days to yesterday=${between(dayStart(14), dayStart(0))} prior 14=${between(dayStart(28), dayStart(14))}`);
  const callbacks = plan.tasks.filter((t) => t.kind === "callback");
  console.log(`callbacks: total=${callbacks.length} on_time=${count(callbacks, (t) => t.done_at !== null && (t.due_at === null || t.done_at <= t.due_at))} late=${count(callbacks, (t) => t.done_at !== null && t.due_at !== null && t.done_at > t.due_at)} open_escalated=${count(callbacks, (t) => t.done_at === null)}; open tasks: ${tally(plan.tasks.filter((t) => t.done_at === null).map((t) => t.kind))}`);
  const { thisWeek, nextWeek, end } = demoWeeks(now);
  for (const [id, name] of names) {
    const mine = plan.bookings.filter((b) => b.designer_id === id);
    if (mine.length === 0) continue;
    const week = (from: Date, to: Date) => {
      const rows = mine.filter((b) => b.start_at >= from && b.start_at < to);
      return `${rows.length} (${tally(rows.map((b) => b.status))})`;
    };
    const leads = new Set(plan.enquiries.filter((e) => e.assigned_designer_id === id).map((e) => e.id));
    const accepted = plan.handoffs.filter((h) => h.accepted_by === id);
    console.log(`${name}: this week ${week(thisWeek, nextWeek)}, next week ${week(nextWeek, end)}; handoffs fast=${count(accepted, (h) => !h.reminded_at)} slow=${count(accepted, (h) => h.reminded_at !== null)}; won=${count(plan.enquiries, (e) => leads.has(e.id) && e.consult_result === "won")} lost=${count(plan.enquiries, (e) => leads.has(e.id) && e.consult_result === "lost")}; callbacks=${count(callbacks, (t) => leads.has(t.enquiry_id))}`);
  }
  for (const [label, day] of [["today", today], ["tomorrow", tomorrow]] as const) {
    const rows = plan.bookings.filter((b) => istDay(b.start_at) === day).sort((a, b) => a.start_at.getTime() - b.start_at.getTime());
    console.log(`${label}: ${rows.map((b) => `${ist(b.start_at).toISOString().slice(11, 16)} ${b.consult_type} ${names.get(b.designer_id ?? "") ?? "unassigned"}${b.status === "booked" ? "" : ` (${b.status})`}`).join("; ") || "none"}`);
  }
  if (skippedEvals.length > 0) console.log(`eval runs not added (real runs exist): ${skippedEvals.join(", ")}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
