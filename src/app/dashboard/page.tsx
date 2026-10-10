import { rawSql } from "@/db/client";
import { SCHEMA_NAME } from "@/db/schema";
import { costs, overview, parseRange } from "@/lib/dashboard/metrics";
import { loadSettings } from "@/lib/settings/store";
import { requireStaff } from "@/lib/auth";
import { Card, ColumnChart, CRITERION_LABEL, inr, Meter, MeterCell, Notice, OUTCOME_LABEL, PageHeader, pct, RangePicker, Stat, Table } from "./ui";

export const dynamic = "force-dynamic";

export default async function Overview({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; error?: string }> }) {
  await requireStaff();
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

  const outcomeRows = Object.entries(data.outcomes).sort((a, b) => b[1] - a[1]);
  const outcomeMax = Math.max(0, ...outcomeRows.map(([, n]) => n));
  const funnel: [string, number][] = [
    ["Enquiries", data.enquiries],
    ["Qualified", qualified],
    ["Booked", data.booked],
    ["Consulted", data.consulted],
    ["Won", data.won],
  ];

  return (
    <main className="flex flex-col gap-6">
      {params.error === "forbidden" && <Notice tone="warn">Only admins can change settings.</Notice>}
      <PageHeader title="Overview" eyebrow="How the front desk did in this range">
        <RangePicker range={range} path="/dashboard" />
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 lg:grid-cols-4">
        <Stat tone="accent" label="Calls answered" value={data.calls} hint="Every call is answered by the agent" href={`/dashboard/calls${q}`} />
        <Stat label="After hours" value={`${data.after_hours_calls} (${pct(data.after_hours_share)})`} hint="Outside office hours and days" meter={{ value: data.after_hours_share, max: 1 }} />
        <Stat label="Qualified enquiries" value={qualified} href={`/dashboard/calls${q}&outcome=QUALIFIED`} meter={{ value: qualified, max: data.enquiries }} />
        <Stat label="Consultations booked" value={data.booked} />
        <Stat label="Won" value={data.won} hint={`${data.lost} lost`} meter={{ value: data.won, max: data.won + data.lost }} />
        <Stat label="Pipeline value (won)" value={inr(data.pipeline_value_inr)} hint="Won projects × average project value" />
        <Stat label="Designer accept time" value={data.median_accept_minutes === null ? "-" : `${data.median_accept_minutes} min`} hint={`${data.escalations} escalated`} href={`/dashboard/designers${q}`} />
        <Stat label="Total running cost" value={inr(cost.total_inr)} hint={`${inr(cost.per_qualified_lead)} per qualified lead`} href={`/dashboard/costs${q}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Card title="Outcomes">
          <Table head={["Outcome", "Enquiries"]} rows={outcomeRows.map(([outcome, n]) => [OUTCOME_LABEL[outcome] ?? outcome, <MeterCell key="n" value={n} max={outcomeMax} />])} />
          {data.top_failing_criterion && (
            <p className="mt-4 rounded-2xl bg-surface-2 px-4 py-3 text-sm text-ink-muted">
              Most common reason for not qualifying: <b className="font-medium text-ink">{CRITERION_LABEL[data.top_failing_criterion.id]}</b> ({data.top_failing_criterion.count})
            </p>
          )}
        </Card>
        <Card title="Funnel">
          <ColumnChart label="Funnel" data={funnel.map(([label, value]) => ({ label, value }))} />
          <Table head={["Stage", "Count"]} rows={funnel} />
          <div className="mt-4 flex flex-col gap-2 rounded-2xl bg-surface-2 px-4 py-3 text-sm text-ink-muted">
            <p>
              Callbacks kept on time: {data.callbacks_on_time} of {data.callbacks_total}
            </p>
            <Meter value={data.callbacks_on_time} max={data.callbacks_total} />
          </div>
        </Card>
      </div>
    </main>
  );
}
