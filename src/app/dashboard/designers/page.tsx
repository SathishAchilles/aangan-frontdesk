import { rawSql } from "@/db/client";
import { SCHEMA_NAME } from "@/db/schema";
import { designers, parseRange } from "@/lib/dashboard/metrics";
import { loadSettings } from "@/lib/settings/store";
import { Card, pct, RangePicker, Table } from "../ui";

export const dynamic = "force-dynamic";

export default async function Designers({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const range = parseRange(await searchParams);
  const rows = await designers(rawSql(), SCHEMA_NAME, range);
  const { values } = await loadSettings();
  const limit = Number(values.accept_escalate_min ?? 30);
  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold">Designers</h1>
        <RangePicker range={range} path="/dashboard/designers" />
      </div>
      <Card>
        <Table
          head={["Designer", "Assigned", "Median accept time", "Escalations", "Won", "Lost", "Won rate"]}
          rows={rows.map((row) => [
            row.name,
            row.assigned,
            row.median_accept_minutes === null ? (
              "-"
            ) : (
              <span key="m" className={row.median_accept_minutes > limit ? "font-semibold text-red-700 dark:text-red-400" : ""}>
                {row.median_accept_minutes} min
              </span>
            ),
            row.escalations,
            row.won,
            row.lost,
            pct(row.won_rate),
          ])}
        />
        <p className="mt-3 text-xs text-zinc-500">Highlighted: median accept time above the {limit}-minute escalation threshold.</p>
      </Card>
    </main>
  );
}
