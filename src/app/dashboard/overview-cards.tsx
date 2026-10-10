// The cards of the Overview page. All synchronous: the page fetches everything first.
import Link from "next/link";
import type { ReactNode } from "react";
import type { DayPoint, FunnelStep, Insights, RecentCall, UpcomingConsult } from "@/lib/dashboard/insights";
import { AreaLineChart, CategoryBar, Donut, FunnelBars, Sparkline, Tracker } from "./charts";
import { Badge, CRITERION_LABEL, inr, LiveDot, Meter, OUTCOME_LABEL, OUTCOME_TONE } from "./ui";

const IST_OFFSET_MS = 330 * 60_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ist = (date: Date) => new Date(date.getTime() + IST_OFFSET_MS);
const pad = (n: number) => String(n).padStart(2, "0");
export const istClock = (date: Date) => `${pad(ist(date).getUTCHours())}:${pad(ist(date).getUTCMinutes())}`;
const istDayMonth = (date: Date) => `${ist(date).getUTCDate()} ${MONTHS[ist(date).getUTCMonth()]}`;
const istWeekday = (date: Date) => WEEKDAYS[ist(date).getUTCDay()];
// "2026-09-28" -> "28 Sep"
export const dayLabel = (day: string) => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
const num = (n: number) => n.toLocaleString("en-IN");
const pct1 = (share: number) => `${(share * 100).toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

// Literal class names (Tailwind only emits classes it can see written out in full).
export const OUTCOME_FILL: Record<string, { bg: string; stroke: string }> = {
  QUALIFIED: { bg: "bg-accent", stroke: "stroke-accent" },
  QUALIFIED_WITH_NOTES: { bg: "bg-chart-2", stroke: "stroke-chart-2" },
  NOT_QUALIFIED: { bg: "bg-chart-3", stroke: "stroke-chart-3" },
  NEEDS_HUMAN: { bg: "bg-chart-4", stroke: "stroke-chart-4" },
  NOT_ENQUIRY: { bg: "bg-chart-5", stroke: "stroke-chart-5" },
  PENDING: { bg: "bg-chart-6", stroke: "stroke-chart-6" },
};
const UNLINKED = { bg: "bg-line-strong", stroke: "stroke-line-strong" };
const outcomeKey = (call: RecentCall) => call.outcome ?? "UNLINKED";
const outcomeLabel = (key: string) => (key === "UNLINKED" ? "No enquiry linked" : (OUTCOME_LABEL[key] ?? key));
const outcomeFill = (key: string) => OUTCOME_FILL[key] ?? UNLINKED;

export function Panel({ title, sub, aside, children, className = "", id }: { title: string; sub?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section aria-labelledby={headingId} className={`relative min-w-0 rounded-3xl border border-line bg-surface p-5 shadow-card sm:p-6 ${className}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h2 id={headingId} className="text-sm font-semibold tracking-tight text-ink">
            {title}
          </h2>
          {sub && <div className="mt-0.5 text-[13px] text-ink-muted">{sub}</div>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="shrink-0 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-ink-muted">{children}</span>;
}

const Arrow = ({ up }: { up: boolean }) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d={up ? "M12 19V5M5 12l7-7 7 7" : "M12 5v14M19 12l-7 7-7-7"} />
  </svg>
);

// Change against the prior period: green when up, red when down, grey when flat or new.
function Delta({ value, unit, fresh }: { value: number | null; unit: "%" | "pp"; fresh?: boolean }) {
  const shell = "inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap tabular-nums";
  if (value === null) return fresh ? <span className={`${shell} bg-surface-2 text-ink-muted`}>New</span> : null;
  const flat = Math.abs(value) < 0.05;
  const up = value > 0;
  const text = `${Math.abs(value).toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}${unit === "pp" ? " pp" : "%"}`;
  return (
    <span className={`${shell} ${flat ? "bg-surface-2 text-ink-muted" : up ? "bg-ok-bg text-ok" : "bg-danger-bg text-danger"}`}>
      {!flat && <Arrow up={up} />}
      <span className="sr-only">{flat ? "No change" : up ? "Up" : "Down"}</span>
      {text}
      <span className="sr-only"> on the prior period</span>
    </span>
  );
}

function Kpi({ title, tag, value, delta, from, children, href }: { title: string; tag: string; value: string; delta?: ReactNode; from: ReactNode; children: ReactNode; href?: string }) {
  const body = (
    <div className={`flex h-full flex-col rounded-3xl border border-line bg-surface p-5 shadow-card ${href ? "lift" : ""}`}>
      <div className="flex items-center justify-between gap-2 text-[13px] font-medium text-ink-muted">
        <h3>{title}</h3>
        <Tag>{tag}</Tag>
      </div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-[32px] leading-tight font-semibold tracking-tight text-ink tabular-nums">{value}</span>
        {delta}
      </div>
      <div className="mt-0.5 text-xs text-ink-muted">{from}</div>
      <div className="mt-auto pt-4">{children}</div>
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-3xl">
      {body}
    </Link>
  ) : (
    <div>{body}</div>
  );
}

const COST_LABEL: Record<string, string> = { agent_min: "Voice agent minutes", telephony_min: "Telephony minutes", ai_in_tok: "AI input tokens", ai_out_tok: "AI output tokens" };
const COST_FILL: Record<string, string> = { agent_min: "bg-accent", telephony_min: "bg-chart-5", ai_in_tok: "bg-chart-2", ai_out_tok: "bg-chart-7", fixed: "bg-chart-4" };

export function KpiRow({ data, query }: { data: Insights; query: string }) {
  const { kpis, days, series } = data;
  const tag = `${days}d`;
  const priorText = `the prior ${days} ${days === 1 ? "day" : "days"}`;
  const legend: [string, string] = ["This period", "Prior period"];
  const rate = (d: DayPoint) => (d.enquiries > 0 ? d.qualified / d.enquiries : null);
  const cost = data.cost;
  const kinds = ["agent_min", "telephony_min", "ai_in_tok", "ai_out_tok"];
  const parts = [
    ...kinds.map((kind) => ({ key: kind, label: COST_LABEL[kind], value: cost.by_kind[kind] ?? 0 })),
    ...(cost.fixed_inr > 0 ? [{ key: "fixed", label: "Fixed monthly plans", value: cost.fixed_inr }] : []),
  ]
    .sort((a, b) => b.value - a.value)
    .map((p) => ({ ...p, className: COST_FILL[p.key], display: inr(p.value) }));
  const afterHours = data.current.after_hours_share;
  return (
    <div className="stagger grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:col-span-12 xl:grid-cols-5">
      <Kpi
        title="Calls answered"
        tag={tag}
        value={num(kpis.calls.current)}
        href={`/dashboard/calls${query}`}
        delta={<Delta value={kpis.calls.change_pct} unit="%" fresh={kpis.calls.current > 0} />}
        from={
          <>
            from <b className="font-medium text-ink">{num(kpis.calls.prior)}</b> in {priorText}
          </>
        }
      >
        <Sparkline id="spark-calls" current={series.current.map((d) => d.calls)} prior={series.prior.map((d) => d.calls)} label={`Calls per day, this period against ${priorText}`} legend={legend} start={0.55} />
      </Kpi>
      <Kpi
        title="Qualification rate"
        tag={tag}
        value={kpis.qualification_rate.current === null ? "–" : pct1(kpis.qualification_rate.current)}
        delta={<Delta value={kpis.qualification_rate.change_pp} unit="pp" />}
        from={
          kpis.qualification_rate.prior === null ? (
            `No enquiries in ${priorText}`
          ) : (
            <>
              from <b className="font-medium text-ink">{pct1(kpis.qualification_rate.prior)}</b> in {priorText}
            </>
          )
        }
      >
        <Sparkline id="spark-rate" current={series.current.map(rate)} prior={series.prior.map(rate)} label={`Share of enquiries qualified per day, this period against ${priorText}`} legend={legend} start={0.62} />
      </Kpi>
      <Kpi
        title="Consultations booked"
        tag={tag}
        value={num(kpis.booked.current)}
        delta={<Delta value={kpis.booked.change_pct} unit="%" fresh={kpis.booked.current > 0} />}
        from={
          <>
            from <b className="font-medium text-ink">{num(kpis.booked.prior)}</b> in {priorText}
          </>
        }
      >
        <Sparkline id="spark-booked" current={series.current.map((d) => d.booked)} prior={series.prior.map((d) => d.booked)} label={`Consultations booked per day, this period against ${priorText}`} legend={legend} start={0.69} />
      </Kpi>
      <Kpi
        title="After-hours calls"
        tag={tag}
        value={data.current.inbound_calls > 0 ? `${Math.round(afterHours * 100)}%` : "–"}
        from={`${num(data.current.after_hours_calls)} of ${num(data.current.inbound_calls)} inbound calls came outside studio hours`}
      >
        <Meter value={afterHours} max={1} className="h-2" />
        <div className="mt-2 flex justify-between text-xs text-ink-muted tabular-nums">
          <span>{`After hours ${Math.round(afterHours * 100)}%`}</span>
          <span>{`Studio hours ${data.current.inbound_calls > 0 ? 100 - Math.round(afterHours * 100) : 0}%`}</span>
        </div>
      </Kpi>
      <Kpi
        title="Cost per qualified lead"
        tag={tag}
        value={inr(cost.per_qualified_lead)}
        href={`/dashboard/costs${query}`}
        from={`${inr(cost.total_inr)} total ÷ ${num(data.qualified.current)} qualified${cost.fixed_inr > 0 ? `, incl. ${inr(cost.fixed_inr)} fixed` : ""}`}
      >
        <CategoryBar parts={parts} total={cost.total_inr} />
      </Kpi>
    </div>
  );
}

export function TodayCard({ data, now }: { data: Insights; now: Date }) {
  const date = now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" });
  const calls = data.recent;
  const last = calls[calls.length - 1];
  const keys = [...Object.keys(OUTCOME_FILL), "UNLINKED"].filter((key) => calls.some((call) => outcomeKey(call) === key));
  const stats: [number, string][] = [
    [data.today.calls, "Calls answered"],
    [data.today.qualified, "Qualified"],
    [data.today.consults, "Consults today"],
  ];
  return (
    <Panel
      id="today"
      title="Today"
      sub={date}
      className="flex flex-col lg:col-span-5 lg:self-start xl:col-span-4"
      aside={
        <span className="inline-flex items-center gap-2 text-xs font-semibold text-ok">
          <LiveDot />
          {`Live · as of ${istClock(now)} IST`}
        </span>
      }
    >
      <dl className="mb-5 grid grid-cols-3">
        {stats.map(([value, label], i) => (
          <div key={label} className={`flex flex-col-reverse ${i > 0 ? "border-l border-line pl-4" : ""}`}>
            <dt className="text-[13px] text-ink-muted">{label}</dt>
            <dd className="text-[40px] leading-[1.05] font-semibold tracking-tight text-ink tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {calls.length === 0 ? (
        <p className="rounded-2xl bg-surface-2 px-4 py-6 text-center text-sm text-ink-soft">No calls yet.</p>
      ) : (
        <>
          <div className="mb-2 flex justify-between gap-2 text-xs font-medium text-ink-muted">
            <span>Recent calls · one tick per call</span>
            <span>{`Last ${calls.length} ${calls.length === 1 ? "call" : "calls"}`}</span>
          </div>
          <Tracker
            label={`Last ${calls.length} calls, oldest first: ${calls.map((call) => outcomeLabel(outcomeKey(call))).join(", ")}`}
            ticks={calls.map((call) => ({
              key: call.id,
              className: outcomeFill(outcomeKey(call)).bg,
              title: `${istDayMonth(call.at)} ${istClock(call.at)} · ${call.caller} · ${outcomeLabel(outcomeKey(call))}`,
            }))}
          />
          <div className="mt-1.5 flex justify-between text-[11px] text-ink-soft tabular-nums">
            <span>{`${istDayMonth(calls[0].at)} ${istClock(calls[0].at)}`}</span>
            <span>{`${istDayMonth(last.at)} ${istClock(last.at)}`}</span>
          </div>
          <ul className="mt-3 mb-4 flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-ink-muted">
            {keys.map((key) => (
              <li key={key} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-[3px] ${outcomeFill(key).bg}`} />
                {`${outcomeLabel(key)} ${calls.filter((call) => outcomeKey(call) === key).length}`}
              </li>
            ))}
          </ul>
          <Link
            href={`/dashboard/calls/${last.id}`}
            className="lift mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-line bg-surface-2 px-3 py-2.5 text-[13px] text-ink-muted"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            Last call <b className="font-medium text-ink tabular-nums">{istClock(last.at)}</b>
            <span className="min-w-0 truncate">{`· ${last.caller}`}</span>
            <span className="ml-auto">
              <Badge tone={last.outcome ? (OUTCOME_TONE[last.outcome] ?? "neutral") : "neutral"}>{outcomeLabel(outcomeKey(last))}</Badge>
            </span>
          </Link>
        </>
      )}
    </Panel>
  );
}

export function ActivityCard({ data }: { data: Insights }) {
  const days = data.series.current.map((d) => ({ day: d.day, label: dayLabel(d.day), calls: d.calls, qualified: d.qualified, booked: d.booked }));
  const split = data.days === 14 ? { at: 7, before: "Earlier 7 days", after: "Last 7 days" } : undefined;
  return (
    <Panel
      id="activity"
      title="Daily activity"
      sub={`${num(data.kpis.calls.current)} calls · ${num(data.qualified.current)} qualified · ${num(data.kpis.booked.current)} consultations booked`}
      className="lg:col-span-12 xl:col-span-8"
      aside={
        <div aria-hidden="true" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
          <span className="inline-flex items-center gap-1.5">
            <i className="h-2.5 w-2.5 rounded-[3px] border-[1.5px] border-chart-2 bg-accent-soft" />
            Calls
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="w-3.5 border-t-[2.5px] border-accent" />
            Qualified
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="w-3.5 border-t-2 border-dashed border-ink-muted" />
            Booked
          </span>
          <Tag>{`${data.days}d`}</Tag>
        </div>
      }
    >
      <AreaLineChart id="activity-area" days={days} split={split} />
    </Panel>
  );
}

const STAGE_LABEL: Record<FunnelStep["stage"], string> = { enquiries: "Enquiries", qualified: "Qualified", booked: "Booked", consulted: "Consulted", won: "Won" };

export function FunnelCard({ data }: { data: Insights }) {
  const enquiries = data.funnel[0]?.value ?? 0;
  const won = data.funnel[data.funnel.length - 1]?.value ?? 0;
  return (
    <Panel
      id="funnel"
      title="Conversion funnel"
      sub={enquiries > 0 ? `${pct1(won / enquiries)} of enquiries became projects` : "No enquiries in this range"}
      className="lg:col-span-12 xl:col-span-4"
      aside={<Tag>{`${data.days}d`}</Tag>}
    >
      <FunnelBars steps={data.funnel.map((step) => ({ label: STAGE_LABEL[step.stage], value: step.value, share: step.share, stepRate: step.step_rate }))} />
    </Panel>
  );
}

export function OutcomesCard({ data }: { data: Insights }) {
  const total = data.outcomes.reduce((sum, o) => sum + o.n, 0);
  const slices = data.outcomes.map((o) => ({ key: o.outcome, label: outcomeLabel(o.outcome), value: o.n, className: outcomeFill(o.outcome).stroke }));
  const failing = data.current.top_failing_criterion;
  return (
    <Panel id="outcomes" title="Call outcomes" sub="How every enquiry in this range ended" aside={<Tag>{`${data.days}d`}</Tag>}>
      {total === 0 ? (
        <p className="rounded-2xl bg-surface-2 px-4 py-6 text-center text-sm text-ink-soft">No enquiries in this range.</p>
      ) : (
        <div className="flex flex-col items-center gap-5 min-[440px]:flex-row min-[440px]:items-center">
          <Donut slices={slices} total={total} caption={total === 1 ? "enquiry" : "enquiries"} label={`Outcomes: ${slices.map((s) => `${s.label} ${s.value}`).join(", ")}`} />
          <table className="w-full min-w-0 text-[13px]">
            <caption className="sr-only">Enquiries by outcome</caption>
            <tbody>
              {slices.map((s) => (
                <tr key={s.key}>
                  <th scope="row" className="py-[3px] text-left font-normal text-ink">
                    <span className="inline-flex items-center gap-2">
                      <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-[3px] ${outcomeFill(s.key).bg}`} />
                      {s.label}
                    </span>
                  </th>
                  <td className="py-[3px] pl-3 text-right font-semibold text-ink tabular-nums">{num(s.value)}</td>
                  <td className="w-12 py-[3px] text-right text-ink-soft tabular-nums">{`${Math.round((s.value / total) * 100)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {failing && (
        <p className="mt-4 rounded-2xl bg-surface-2 px-4 py-2.5 text-xs text-ink-muted">
          Most common reason for not qualifying: <b className="font-medium text-ink">{CRITERION_LABEL[failing.id] ?? failing.id}</b> ({failing.count})
        </p>
      )}
    </Panel>
  );
}

const minutes = (value: number | null) => (value === null ? "–" : `${value.toLocaleString("en-IN", { maximumFractionDigits: 1 })} min`);

export function DesignersCard({ data }: { data: Insights }) {
  const rows = [...data.designers].sort((a, b) => b.assigned - a.assigned || a.name.localeCompare(b.name));
  const max = Math.max(1, ...rows.map((row) => row.assigned));
  return (
    <Panel
      id="designers"
      title="Designers"
      sub="Leads handed over, projects won, time to accept a handoff"
      aside={<Tag>{`${data.days}d`}</Tag>}
    >
      {rows.length === 0 ? (
        <p className="rounded-2xl bg-surface-2 px-4 py-6 text-center text-sm text-ink-soft">No active designers.</p>
      ) : (
        <table className="w-full table-fixed text-[13px]">
          <caption className="sr-only">Leads assigned, projects won and median time to accept a handoff, per designer</caption>
          <thead>
            <tr className="text-[11px] tracking-wider text-ink-soft uppercase">
              <th scope="col" className="pb-2 text-left font-medium">
                Designer · leads
              </th>
              <th scope="col" className="w-[76px] pb-2 text-right font-medium">
                Won
              </th>
              <th scope="col" className="w-[84px] pb-2 text-right font-medium sm:w-[112px]">
                <span className="sm:hidden">Accept</span>
                <span className="max-sm:hidden">Median accept</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const match = row.name.match(/^(.*?)\s*\((.+)\)$/);
              const name = match ? match[1] : row.name;
              const role = match ? match[2] : null;
              return (
                <tr key={row.id}>
                  <th scope="row" className="py-1 pr-3 text-left font-normal">
                    <span className="relative flex h-[34px] items-center overflow-hidden rounded-[10px]">
                      <span aria-hidden="true" className="grow-x absolute inset-y-0 left-0 rounded-[10px] bg-accent-soft" style={{ width: `${(row.assigned / max) * 100}%`, animationDelay: `${0.8 + i * 0.1}s` }} />
                      <span className="relative flex min-w-0 items-center gap-1.5 px-3 whitespace-nowrap">
                        <span className="truncate font-medium text-ink">{name}</span>
                        {role && <span className="rounded-md bg-surface px-1.5 text-[10.5px] font-semibold text-accent-soft-ink capitalize max-sm:hidden">{role}</span>}
                        <span className="text-xs text-ink-muted tabular-nums">{`${row.assigned} ${row.assigned === 1 ? "lead" : "leads"}`}</span>
                      </span>
                    </span>
                  </th>
                  <td className="py-1 text-right font-semibold text-ink tabular-nums">
                    {row.won}
                    <span className="text-[11px] font-normal text-ink-soft">{row.won_rate === null ? "" : ` · ${Math.round(row.won_rate * 100)}%`}</span>
                  </td>
                  <td className="py-1 text-right font-semibold text-ink tabular-nums">{minutes(row.median_accept_minutes)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="mt-3 border-t border-dashed border-line pt-3 text-xs text-ink-muted">
        {data.designer_insight ?? "Not enough handoffs in this range to compare designers."}
        <span className="text-ink-soft"> Win rate is won ÷ (won + lost).</span>
      </p>
    </Panel>
  );
}

const CONSULT: Record<string, { label: string; icon: string }> = {
  site: { label: "Site visit", icon: "M12 21s-7-5.6-7-11a7 7 0 0 1 14 0c0 5.4-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" },
  studio: { label: "Studio consultation", icon: "M3 21h18M5 21V8l7-5 7 5v13M10 21v-6h4v6" },
  principal: { label: "Principal visit", icon: "m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z" },
};
const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "neutral" }> = { booked: { label: "Booked", tone: "ok" }, rescheduled: { label: "Rescheduled", tone: "warn" } };

export function UpcomingCard({ data, now }: { data: Insights; now: Date }) {
  const groups: [string, UpcomingConsult[]][] = [
    [`Today · ${istWeekday(now)} ${istDayMonth(now)}`, data.upcoming.filter((u) => u.day === "today")],
    [`Tomorrow · ${istWeekday(new Date(now.getTime() + 86_400_000))} ${istDayMonth(new Date(now.getTime() + 86_400_000))}`, data.upcoming.filter((u) => u.day === "tomorrow")],
  ];
  return (
    <Panel id="upcoming" title="Upcoming consultations" sub="Booked by the front desk · today and tomorrow" className="lg:col-span-12 xl:col-span-7" aside={<Tag>{`${data.upcoming.length} upcoming`}</Tag>}>
      {data.upcoming.length === 0 ? (
        <p className="rounded-2xl bg-surface-2 px-4 py-6 text-center text-sm text-ink-soft">No consultations for the rest of today or tomorrow.</p>
      ) : (
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[580px] text-[13px]">
            <caption className="sr-only">Consultations today and tomorrow, IST</caption>
            {groups
              .filter(([, rows]) => rows.length > 0)
              .map(([heading, rows]) => (
                <tbody key={heading}>
                  <tr>
                    <th colSpan={5} scope="colgroup" className="pt-2 pb-1.5 text-left text-[11px] font-semibold tracking-[0.07em] text-ink-soft uppercase">
                      {heading}
                    </th>
                  </tr>
                  {rows.map((u, i) => {
                    const type = CONSULT[u.consult_type] ?? { label: u.consult_type, icon: "" };
                    const status = STATUS[u.status] ?? { label: u.status, tone: "neutral" as const };
                    return (
                      <tr key={u.id} className={i > 0 ? "border-t border-line" : ""}>
                        <td className="w-14 py-2.5 pr-3 text-sm font-semibold text-ink tabular-nums">{istClock(u.start_at)}</td>
                        <td className="py-2.5 pr-3">
                          <span className="font-medium text-ink">{u.caller}</span>
                          {u.locality && <span className="text-xs text-ink-muted">{` · ${u.locality}`}</span>}
                        </td>
                        <td className="py-2.5 pr-3 whitespace-nowrap text-ink">
                          <span className="inline-flex items-center gap-1.5">
                            {type.icon && (
                              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 text-accent" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d={type.icon} />
                              </svg>
                            )}
                            {type.label}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 text-xs text-ink-muted">{u.designer ?? "No designer yet"}</td>
                        <td className="py-2.5 text-right">
                          <Badge tone={status.tone}>{status.label}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
          </table>
        </div>
      )}
    </Panel>
  );
}
