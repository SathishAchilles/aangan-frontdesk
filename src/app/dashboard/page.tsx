import { rawSql } from "@/db/client";
import { SCHEMA_NAME } from "@/db/schema";
import { costs, overview, parseRange } from "@/lib/dashboard/metrics";
import { loadSettings } from "@/lib/settings/store";
import { Card, CRITERION_LABEL, inr, OUTCOME_LABEL, pct, RangePicker, Stat, Table } from "./ui";

export const dynamic = "force-dynamic";

export default async function Overview({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; error?: string }> }) {
  const params = await searchParams;
  const range = parseRange(params);
  const { values } = await loadSettings();
  const hours = values.office_hours as { start: string; end: string };
  const sql = rawSql();
  const data = await overview(sql, SCHEMA_NAME, range, {
    officeStart: hours.start,
    officeEnd: hours.end,
    officeDays: values.office_days as string[],
    avgProjectValueInr: Number(values.avg_project_value_inr ?? 1100000),
  });
  const qualified = (data.outcomes.QUALIFIED ?? 0) + (data.outcomes.QUALIFIED_WITH_NOTES ?? 0);
  const cost = await costs(sql, SCHEMA_NAME, range, { calls: data.calls, qualified, booked: data.booked, won: data.won });
  const q = `?from=${range.from}&to=${range.to}`;

  return (
    <main className="flex flex-col gap-6">
      {params.error === "forbidden" && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">Only admins can change settings.</p>}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold">Overview</h1>
        <RangePicker range={range} path="/dashboard" />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Calls answered" value={data.calls} hint="Every call is answered by the agent" href={`/dashboard/calls${q}`} />
        <Stat label="After hours" value={`${data.after_hours_calls} (${pct(data.after_hours_share)})`} hint="Outside office hours and days" />
        <Stat label="Qualified enquiries" value={qualified} href={`/dashboard/calls${q}&outcome=QUALIFIED`} />
        <Stat label="Consultations booked" value={data.booked} />
        <Stat label="Won" value={data.won} hint={`${data.lost} lost`} />
        <Stat label="Pipeline value (won)" value={inr(data.pipeline_value_inr)} hint="Won projects × average project value" />
        <Stat label="Designer accept time" value={data.median_accept_minutes === null ? "-" : `${data.median_accept_minutes} min`} hint={`${data.escalations} escalated`} href={`/dashboard/designers${q}`} />
        <Stat label="Total running cost" value={inr(cost.total_inr)} hint={`${inr(cost.per_qualified_lead)} per qualified lead`} href={`/dashboard/costs${q}`} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Outcomes">
          <Table
            head={["Outcome", "Enquiries"]}
            rows={Object.entries(data.outcomes)
              .sort((a, b) => b[1] - a[1])
              .map(([outcome, n]) => [OUTCOME_LABEL[outcome] ?? outcome, n])}
          />
          {data.top_failing_criterion && (
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
              Most common reason for not qualifying: <b>{CRITERION_LABEL[data.top_failing_criterion.id]}</b> ({data.top_failing_criterion.count})
            </p>
          )}
        </Card>
        <Card title="Funnel">
          <Table
            head={["Stage", "Count"]}
            rows={[
              ["Enquiries", data.enquiries],
              ["Qualified", qualified],
              ["Booked", data.booked],
              ["Consulted", data.consulted],
              ["Won", data.won],
            ]}
          />
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            Callbacks kept on time: {data.callbacks_on_time} of {data.callbacks_total}
          </p>
        </Card>
      </div>
    </main>
  );
}
