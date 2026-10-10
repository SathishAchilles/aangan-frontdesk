import { rawSql } from "@/db/client";
import { SCHEMA_NAME } from "@/db/schema";
import { attention } from "@/lib/dashboard/attention";
import { addDays, DEFAULT_DAYS, insights, istToday, overviewRange } from "@/lib/dashboard/insights";
import { loadSettings } from "@/lib/settings/store";
import { requireStaff } from "@/lib/auth";
import type { DayKey } from "@/lib/rules/time";
import { AttentionPanel } from "./attention-panel";
import { ActivityCard, dayLabel, DesignersCard, FunnelCard, KpiRow, OutcomesCard, TodayCard, UpcomingCard } from "./overview-cards";
import { Notice, RangePicker, renderedAt } from "./ui";

export const dynamic = "force-dynamic";

export default async function Overview({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; error?: string }> }) {
  await requireStaff();
  const params = await searchParams;
  const now = renderedAt();
  const range = overviewRange(params, now);
  const { values } = await loadSettings();
  const hours = values.office_hours as { start: string; end: string };
  const sql = rawSql();
  const [data, needs] = await Promise.all([
    insights(
      sql,
      SCHEMA_NAME,
      range,
      { officeStart: hours.start, officeEnd: hours.end, officeDays: values.office_days as string[], avgProjectValueInr: Number(values.avg_project_value_inr ?? 1100000) },
      now,
    ),
    attention(sql, SCHEMA_NAME, now, { acceptEscalateMin: Number(values.accept_escalate_min ?? 30), office: { start: hours.start, end: hours.end, days: values.office_days as DayKey[] } }),
  ]);
  const q = `?from=${range.from}&to=${range.to}`;
  const last = addDays(range.to, -1);
  const isDefault = range.to === addDays(istToday(now), 1) && data.days === DEFAULT_DAYS;
  const span = `${dayLabel(range.from)}${range.from.slice(0, 4) === last.slice(0, 4) ? "" : ` ${range.from.slice(0, 4)}`} – ${dayLabel(last)} ${last.slice(0, 4)}`;

  return (
    <main className="flex flex-col gap-5">
      {params.error === "forbidden" && <Notice tone="warn">Only admins can change settings.</Notice>}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight text-ink">Overview</h1>
          <p className="text-sm text-ink-muted">Calls answered, enquiries qualified and consultations booked by the front desk.</p>
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="inline-flex h-9 items-center gap-2 rounded-full border border-line bg-surface px-3.5 font-medium text-ink shadow-card">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 text-ink-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="3" />
                <path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              {isDefault ? `Last ${DEFAULT_DAYS} days` : `${data.days} ${data.days === 1 ? "day" : "days"}`}
              <span aria-hidden="true" className="h-4 w-px bg-line" />
              <span className="font-normal text-ink-muted">{span}</span>
            </span>
            <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 font-medium text-ink shadow-card">
              <span className="font-normal text-ink-muted">Compare</span>
              Prior period
            </span>
            <span className="text-xs text-ink-soft">All times IST</span>
          </div>
          <RangePicker range={range} path="/dashboard" />
        </div>
      </div>

      <div className="stagger grid grid-cols-1 gap-4 lg:grid-cols-12 xl:gap-[18px]">
        <TodayCard data={data} now={now} />
        <AttentionPanel items={needs} now={now} className="lg:col-span-7 xl:col-span-8" />
        <div className="lg:col-span-12">
          <KpiRow data={data} query={q} />
        </div>
        <ActivityCard data={data} />
        <FunnelCard data={data} />
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-12 xl:col-span-5 xl:gap-[18px]">
          <OutcomesCard data={data} />
          <DesignersCard data={data} />
        </div>
        <UpcomingCard data={data} now={now} />
      </div>
    </main>
  );
}
