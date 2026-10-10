import Link from "next/link";
import { rawSql } from "@/db/client";
import { SCHEMA_NAME } from "@/db/schema";
import { parseRange } from "@/lib/dashboard/metrics";
import { maskPhone } from "@/lib/phone";
import { requireStaff } from "@/lib/auth";
import { Badge, Card, istTime, OUTCOME_LABEL, OUTCOME_TONE, PageHeader, RangePicker, Table } from "../ui";

export const dynamic = "force-dynamic";

export default async function Calls({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; outcome?: string }> }) {
  await requireStaff();
  const params = await searchParams;
  const range = parseRange(params);
  const sql = rawSql();
  const s = (table: string) => sql(`${SCHEMA_NAME}.${table}`);
  const outcome = params.outcome && OUTCOME_LABEL[params.outcome] ? params.outcome : null;
  const rows = await sql<{ id: string; started_at: Date | null; direction: string; duration_s: number | null; phone: string | null; name: string | null; outcome: string | null; dropped: boolean; flags: Record<string, string[]> }[]>`
    select c.id, c.started_at, c.direction, c.duration_s, ca.phone_e164 as phone, ca.name, e.outcome, c.dropped, c.grader_flags as flags
    from ${s("calls")} c
    left join ${s("callers")} ca on ca.id = c.caller_id
    left join ${s("enquiries")} e on e.id = c.enquiry_id
    where c.created_at >= ${`${range.from}T00:00:00+05:30`} and c.created_at < ${`${range.to}T00:00:00+05:30`}
      and (${outcome}::text is null or e.outcome = ${outcome} or (${outcome} = 'QUALIFIED' and e.outcome = 'QUALIFIED_WITH_NOTES'))
    order by c.created_at desc limit 200`;

  return (
    <main className="flex flex-col gap-6">
      <PageHeader title="Calls" eyebrow="Most recent calls in this range (up to 200)">
        <RangePicker range={range} path="/dashboard/calls" />
      </PageHeader>
      <nav aria-label="Filter by outcome" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 text-sm">
        {["", ...Object.keys(OUTCOME_LABEL)].map((key) => {
          const active = outcome === key || (!outcome && !key);
          return (
            <Link
              key={key}
              href={`/dashboard/calls?from=${range.from}&to=${range.to}${key ? `&outcome=${key}` : ""}`}
              aria-current={active ? "page" : undefined}
              className={`shrink-0 rounded-full border px-4 py-1.5 whitespace-nowrap transition ${active ? "border-transparent bg-accent text-accent-ink" : "border-line bg-surface text-ink-muted hover:text-ink"}`}
            >
              {key ? OUTCOME_LABEL[key] : "All"}
            </Link>
          );
        })}
      </nav>
      <Card>
        <Table
          head={["When (IST)", "Caller", "Length", "Outcome", "Checks"]}
          rows={rows.map((row) => [
            <Link key="t" href={`/dashboard/calls/${row.id}`} className="font-medium whitespace-nowrap text-ink underline decoration-line decoration-2 underline-offset-4 hover:decoration-accent">
              {istTime(row.started_at)}
            </Link>,
            `${row.name ?? "Unknown"} · ${row.phone ? maskPhone(row.phone) : "no caller ID"}`,
            row.duration_s ? `${Math.floor(row.duration_s / 60)}m ${row.duration_s % 60}s` : "-",
            row.dropped ? (
              <Badge key="o" tone="warn">
                Dropped
              </Badge>
            ) : row.outcome && OUTCOME_LABEL[row.outcome] ? (
              <Badge key="o" tone={OUTCOME_TONE[row.outcome]}>
                {OUTCOME_LABEL[row.outcome]}
              </Badge>
            ) : (
              "-"
            ),
            (row.flags?.price_figure?.length ?? 0) + (row.flags?.budget_question?.length ?? 0) > 0 ? (
              <Badge key="c" tone="danger">
                ⚠️ Safety flag
              </Badge>
            ) : (
              <Badge key="c" tone="ok">
                OK
              </Badge>
            ),
          ])}
          empty="No calls in this range."
        />
      </Card>
    </main>
  );
}
