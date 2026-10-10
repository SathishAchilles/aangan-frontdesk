import { rawSql } from "@/db/client";
import { SCHEMA_NAME } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { Badge, Card, inr, istTime, PageHeader, Table } from "../ui";

export const dynamic = "force-dynamic";

type Run = { id: string; eval_name: string; started_at: Date; passed: boolean; metrics: Record<string, number>; failed_thresholds: string[]; dataset_version: string; prompt_version: string | null; cost_inr: number };

const HEADLINE: Record<string, string[]> = {
  "gate-accuracy": ["agreement", "false_qualified", "price_leakage"],
  "agent-sim": ["outcome_rate", "tool_correct_rate", "one_question_rate", "price_leakage"],
  "note-accuracy": ["field_accuracy", "unsupported_statements"],
  "tool-latency": ["p95_ms", "server_errors"],
  "tool-leakage": ["price_leakage"],
  "slot-compliance": ["inside_window_rate", "booking_success_rate"],
  "week-simulation": ["missed", "duplicates"],
  idempotency: ["duplicate_side_effects"],
  "data-integrity": ["cross_schema_reads", "constraint_violations"],
};

function format(value: number | undefined) {
  if (value === undefined) return "-";
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

export default async function Quality() {
  await requireStaff();
  const sql = rawSql();
  const runs = await sql<Run[]>`
    select * from (
      select r.*, row_number() over (partition by eval_name order by started_at desc) as n from ${sql(`${SCHEMA_NAME}.eval_runs`)} r
    ) t where n <= 20 order by eval_name, started_at desc`;
  const latest = new Map<string, Run>();
  for (const run of runs) if (!latest.has(run.eval_name)) latest.set(run.eval_name, run);

  return (
    <main className="flex flex-col gap-6">
      <PageHeader title="Quality" eyebrow="Latest eval runs" />
      <Card title="Latest result per eval">
        <Table
          head={["Eval", "When (IST)", "Result", "Key metrics", "Data", "Cost"]}
          rows={[...latest.values()].map((run) => [
            <span key="e" className="font-mono text-xs font-medium">
              {run.eval_name}
            </span>,
            <span key="w" className="whitespace-nowrap">
              {istTime(run.started_at)}
            </span>,
            run.passed ? (
              <Badge key="r" tone="ok">
                ✅ Pass
              </Badge>
            ) : (
              <Badge key="r" tone="danger">{`❌ Fail: ${run.failed_thresholds.join("; ")}`}</Badge>
            ),
            (HEADLINE[run.eval_name] ?? Object.keys(run.metrics).slice(0, 3)).map((key) => `${key} ${format(run.metrics[key])}`).join(" · "),
            run.dataset_version,
            inr(Number(run.cost_inr)),
          ])}
          empty="No eval runs stored yet."
        />
        <p className="mt-4 text-xs text-ink-soft">Gold labels are provisional until the founder confirms them. Simulated agent results estimate quality; real calls are graded separately.</p>
      </Card>
      <Card title="History (last 20 runs per eval)">
        <Table
          head={["Eval", "When (IST)", "Result", "Prompt"]}
          rows={runs.map((run) => [
            <span key="e" className="font-mono text-xs">
              {run.eval_name}
            </span>,
            istTime(run.started_at),
            <Badge key="r" tone={run.passed ? "ok" : "danger"}>
              {run.passed ? "Pass" : "Fail"}
            </Badge>,
            run.prompt_version ?? "-",
          ])}
        />
      </Card>
    </main>
  );
}
