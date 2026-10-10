import { rawSql } from "@/db/client";
import { SCHEMA_NAME } from "@/db/schema";
import { costs, overview, parseRange } from "@/lib/dashboard/metrics";
import { loadSettings } from "@/lib/settings/store";
import { requireStaff } from "@/lib/auth";
import { Card, inr, RangePicker, Stat, Table } from "../ui";

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

  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold">Costs</h1>
        <RangePicker range={range} path="/dashboard/costs" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total" value={inr(cost.total_inr)} hint={`${inr(cost.variable_inr)} usage + ${inr(cost.fixed_inr)} plans`} />
        <Stat label="Per call" value={inr(cost.per_call)} hint={`${data.calls} calls`} />
        <Stat label="Per qualified lead" value={inr(cost.per_qualified_lead)} hint={`${qualified} qualified`} />
        <Stat label="Per booking" value={inr(cost.per_booking)} hint={`${data.booked} booked`} />
        <Stat label="Per won project" value={inr(cost.per_won)} hint={`${data.won} won`} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Usage">
          <Table head={["Item", "Amount"]} rows={Object.entries(cost.by_kind).map(([kind, amount]) => [KIND_LABEL[kind] ?? kind, inr(amount)])} empty="No usage recorded in this range." />
        </Card>
        <Card title="Fixed plans">
          <Table head={["Month", "Item", "Amount"]} rows={fixed.map((row) => [row.month, row.item, inr(row.amount)])} empty="No fixed costs entered. Add them under Settings." />
        </Card>
      </div>
      <p className="text-xs text-zinc-500">Unit prices are copied onto each cost line when it is recorded, so changing a price affects only later calls.</p>
    </main>
  );
}
