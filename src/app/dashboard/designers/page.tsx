import Link from "next/link";
import { rawSql } from "@/db/client";
import { SCHEMA_NAME } from "@/db/schema";
import { designers, parseRange } from "@/lib/dashboard/metrics";
import { schedule } from "@/lib/dashboard/schedule";
import { loadSettings } from "@/lib/settings/store";
import { requireStaff } from "@/lib/auth";
import { Badge, Card, MeterCell, PageHeader, pct, RangePicker, Table } from "../ui";
import { ConsultationCalendar, parseCalendar, type CalendarParams } from "./calendar";

export const dynamic = "force-dynamic";

export default async function Designers({ searchParams }: { searchParams: Promise<CalendarParams> }) {
  const me = await requireStaff();
  const params = await searchParams;
  const range = parseRange(params);
  const now = new Date();
  const cal = parseCalendar(params, now);
  const [rows, meetings] = await Promise.all([designers(rawSql(), SCHEMA_NAME, range), schedule(rawSql(), SCHEMA_NAME, cal.start, cal.end, cal.designer)]);
  const { values } = await loadSettings();
  const limit = Number(values.accept_escalate_min ?? 30);
  return (
    <main className="flex flex-col gap-6">
      <PageHeader title="Designers" eyebrow="How fast each designer picks up a handoff">
        <RangePicker range={range} path="/dashboard/designers" keep={{ view: params.view, week: params.week, date: params.date, designer: params.designer }} />
      </PageHeader>
      <Card>
        <Table
          head={["Designer", "Assigned", "Median accept time", "Escalations", "Won", "Lost", "Won rate"]}
          rows={rows.map((row) => [
            <span key="n" className="flex flex-col items-start gap-0.5">
              <span className="font-medium">{row.name}</span>
              {me.role === "admin" && (
                <Link href={`/designer?as=${row.id}`} className="text-xs text-accent underline-offset-4 hover:underline">
                  Designer view<span className="sr-only"> as {row.name}</span>
                </Link>
              )}
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
      <ConsultationCalendar params={params} cal={cal} meetings={meetings} designers={rows.map((row) => ({ id: row.id, name: row.name }))} now={now} />
    </main>
  );
}
