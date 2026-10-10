import { rawSql } from "@/db/client";
import { SCHEMA_NAME } from "@/db/schema";
import { costs, overview, parseRange } from "@/lib/dashboard/metrics";
import { loadSettings } from "@/lib/settings/store";
import { requireStaff } from "@/lib/auth";
import { Badge, Card, inr, MeterCell, PageHeader, RangePicker, Stat, Table } from "../ui";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  agent_min: "Voice agent minutes (Vaani)",
  telephony_min: "Telephony minutes",
  ai_in_tok: "Gemini input tokens (notes)",
  ai_out_tok: "Gemini output tokens (notes)",
};

export default async function Costs({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireStaff();
  const range = parseRange(await searchParams);
  const { values } = await loadSettings();
  const hours = values.office_hours as { start: string; end: string };
  const sql = rawSql();
  const data = await overview(sql, SCHEMA_NAME, range, { officeStart: hours.start, officeEnd: hours.end, officeDays: values.office_days as string[], avgProjectValueInr: Number(values.avg_project_value_inr ?? 1100000) });
  const qualified = (data.outcomes.QUALIFIED ?? 0) + (data.outcomes.QUALIFIED_WITH_NOTES ?? 0);
  const cost = await costs(sql, SCHEMA_NAME, range, { calls: data.calls, qualified, booked: data.booked, won: data.won });
  const fixed = await sql<{ month: string; item: string; amount: number }[]>`
    select to_char(month, 'YYYY-MM') as month, item, amount_inr::float as amount from ${sql(`${SCHEMA_NAME}.fixed_costs`)}
    where month >= date_trunc('month', ${range.from}::date) and month < ${range.to}::date order by month, item`;

  const usage = Object.entries(cost.by_kind);
  const usageMax = Math.max(0, ...usage.map(([, amount]) => amount));
  const fixedMax = Math.max(0, ...fixed.map((row) => row.amount));
  const usageShare = cost.total_inr > 0 ? cost.variable_inr / cost.total_inr : 0;

  return (
    <main className="flex flex-col gap-6">
      <PageHeader title="Costs" eyebrow="What the front desk costs to run">
        <RangePicker range={range} path="/dashboard/costs" />
      </PageHeader>
      <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 lg:grid-cols-5">
        <Stat tone="accent" label="Total" value={inr(cost.total_inr)} hint={`${inr(cost.variable_inr)} usage + ${inr(cost.fixed_inr)} plans`} meter={{ value: cost.variable_inr, max: cost.total_inr }} />
        <Stat label="Per call" value={inr(cost.per_call)} hint={`${data.calls} calls`} />
        <Stat label="Per qualified lead" value={inr(cost.per_qualified_lead)} hint={`${qualified} qualified`} />
        <Stat label="Per booking" value={inr(cost.per_booking)} hint={`${data.booked} booked`} />
        <Stat label="Per won project" value={inr(cost.per_won)} hint={`${data.won} won`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Usage" action={cost.total_inr > 0 ? <Badge>{`${Math.round(usageShare * 100)}% of the total`}</Badge> : undefined}>
          <Table head={["Item", "Amount"]} rows={usage.map(([kind, amount]) => [KIND_LABEL[kind] ?? kind, <MeterCell key="a" value={amount} max={usageMax}>{inr(amount)}</MeterCell>])} empty="No usage recorded in this range." />
        </Card>
        <Card title="Fixed plans">
          <Table head={["Month", "Item", "Amount"]} rows={fixed.map((row) => [row.month, row.item, <MeterCell key="a" value={row.amount} max={fixedMax}>{inr(row.amount)}</MeterCell>])} empty="No fixed costs entered. Add them under Settings." />
        </Card>
      </div>
      <p className="text-xs text-ink-soft">Unit prices are copied onto each cost line when it is recorded, so changing a price affects only later calls.</p>
    </main>
  );
}
