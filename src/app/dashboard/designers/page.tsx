import { rawSql } from "@/db/client";
import { SCHEMA_NAME } from "@/db/schema";
import { designers, parseRange } from "@/lib/dashboard/metrics";
import { loadSettings } from "@/lib/settings/store";
import { requireStaff } from "@/lib/auth";
import { Badge, Card, MeterCell, PageHeader, pct, RangePicker, Table } from "../ui";

export const dynamic = "force-dynamic";

export default async function Designers({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireStaff();
  const range = parseRange(await searchParams);
  const rows = await designers(rawSql(), SCHEMA_NAME, range);
  const { values } = await loadSettings();
  const limit = Number(values.accept_escalate_min ?? 30);
  return (
    <main className="flex flex-col gap-6">
      <PageHeader title="Designers" eyebrow="How fast each designer picks up a handoff">
        <RangePicker range={range} path="/dashboard/designers" />
      </PageHeader>
      <Card>
        <Table
          head={["Designer", "Assigned", "Median accept time", "Escalations", "Won", "Lost", "Won rate"]}
          rows={rows.map((row) => [
            <span key="n" className="font-medium">
              {row.name}
            </span>,
            row.assigned,
            row.median_accept_minutes === null ? (
              "-"
            ) : (
              row.median_accept_minutes > limit ? (
                <Badge key="m" tone="danger">
                  {row.median_accept_minutes} min
                </Badge>
              ) : (
                <span key="m">{row.median_accept_minutes} min</span>
              )
            ),
            row.escalations,
            row.won,
            row.lost,
            row.won_rate === null ? "-" : <MeterCell key="r" value={row.won_rate} max={1}>{pct(row.won_rate)}</MeterCell>,
          ])}
        />
        <p className="mt-4 text-xs text-ink-soft">Highlighted: median accept time above the {limit}-minute escalation threshold.</p>
      </Card>
    </main>
  );
}
