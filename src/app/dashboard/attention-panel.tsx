import Link from "next/link";
import type { AttentionItem, AttentionKind, Today } from "@/lib/dashboard/attention";
import { Badge, istTime, LiveDot, relTime } from "./ui";

// How many items show before the rest fold under "Show more" (a plain <details>, no JavaScript).
const VISIBLE = 8;

const ICON: Record<AttentionKind, string> = {
  handoff_escalated: "M3.5 10h10M10 6l4 4-4 4M16.5 4v12",
  handoff_overdue: "M3.5 10h10M10 6l4 4-4 4M16.5 4v12",
  handoff_waiting: "M3.5 10h10M10 6l4 4-4 4M16.5 4v12",
  callback_overdue: "M6.5 3.5h-2a1 1 0 0 0-1 1c0 6.6 5.4 12 12 12a1 1 0 0 0 1-1v-2l-3-1.5-1.5 1.5a8 8 0 0 1-5-5L8.5 7 7 3.5z",
  callback_due: "M6.5 3.5h-2a1 1 0 0 0-1 1c0 6.6 5.4 12 12 12a1 1 0 0 0 1-1v-2l-3-1.5-1.5 1.5a8 8 0 0 1-5-5L8.5 7 7 3.5z",
  complaint: "M10 3.5 17 16H3zM10 8.5v3M10 13.8v.2",
  safety_flag: "M10 3 4.5 5v4.5c0 3.6 2.4 6 5.5 7.5 3.1-1.5 5.5-3.9 5.5-7.5V5zM10 7.5v3M10 12.8v.2",
  consult_today: "M4 5.5h12v11H4zM4 9h12M7.5 3.5v3M12.5 3.5v3",
  consult_tomorrow: "M4 5.5h12v11H4zM4 9h12M7.5 3.5v3M12.5 3.5v3",
};

const TONE_CHIP = { danger: "bg-danger-bg text-danger", warn: "bg-warn-bg text-warn", info: "bg-info-bg text-info" };
const TONE_LABEL = { danger: "Urgent", warn: "Soon", info: "Upcoming" };

const duration = (minutes: number) => {
  const m = Math.abs(minutes);
  if (m < 60) return `${m} min`;
  if (m < 24 * 60) {
    const h = Math.floor(m / 60);
    return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  }
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return h ? `${d} d ${h} h` : `${d} d`;
};

function when(item: AttentionItem, now: Date): string {
  const m = item.minutes;
  switch (item.kind) {
    case "handoff_escalated":
    case "handoff_overdue":
    case "handoff_waiting":
      return `Waiting ${duration(m ?? 0)}`;
    case "callback_overdue":
    case "callback_due":
    case "complaint":
      if (m === null) return relTime(item.at, now);
      return m > 0 ? `${duration(m)} late` : `Due in ${duration(m)}`;
    case "consult_today":
    case "consult_tomorrow":
      return `${istTime(item.at).slice(11)} IST · ${relTime(item.at, now)}`;
    default:
      return relTime(item.at, now);
  }
}

function Row({ item, now }: { item: AttentionItem; now: Date }) {
  const body = (
    <>
      <span aria-hidden="true" className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${TONE_CHIP[item.tone]}`}>
        <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d={ICON[item.kind]} />
        </svg>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium break-words text-ink">{item.title}</span>
        <span className="text-xs break-words text-ink-muted">{item.detail}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1 text-right">
        <Badge tone={item.tone}>{TONE_LABEL[item.tone]}</Badge>
        <span className="text-xs whitespace-nowrap text-ink-soft tabular-nums">{when(item, now)}</span>
      </span>
    </>
  );
  const shell = "flex items-start gap-3 rounded-2xl border border-line bg-surface p-3 sm:p-3.5";
  return (
    <li>
      {item.callId ? (
        <Link href={`/dashboard/calls/${item.callId}`} className={`lift ${shell}`}>
          {body}
        </Link>
      ) : (
        <div className={shell}>{body}</div>
      )}
    </li>
  );
}

export function AttentionPanel({ items, now }: { items: AttentionItem[]; now: Date }) {
  const urgent = items.filter((item) => item.tone === "danger").length;
  const shown = items.slice(0, VISIBLE);
  const rest = items.slice(VISIBLE);
  return (
    <section aria-labelledby="attention-title" className="rise min-w-0 rounded-3xl border border-line bg-surface p-5 shadow-card sm:p-7">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id="attention-title" className="flex items-center gap-2.5 text-base font-medium tracking-tight text-ink">
          {urgent > 0 && <LiveDot tone="danger" />}
          Needs attention
        </h2>
        {items.length > 0 && (
          <span className="flex flex-wrap gap-1.5">
            {urgent > 0 && <Badge tone="danger">{`${urgent} urgent`}</Badge>}
            <Badge>{`${items.length} open`}</Badge>
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <div className="rise flex flex-col items-center gap-2 rounded-2xl bg-surface-2 px-4 py-8 text-center">
          <span aria-hidden="true" className="grid h-11 w-11 place-items-center rounded-full bg-ok-bg text-ok">
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 10.5 3.2 3L15 6.5" />
            </svg>
          </span>
          <p className="text-sm font-medium text-ink">Nothing needs attention</p>
          <p className="max-w-sm text-xs text-ink-muted">No waiting handoffs, late callbacks, complaints or safety flags. Consultations for today and tomorrow will show here.</p>
        </div>
      ) : (
        <>
          <ol className="stagger flex flex-col gap-2">
            {shown.map((item) => (
              <Row key={`${item.kind}-${item.id}`} item={item} now={now} />
            ))}
          </ol>
          {rest.length > 0 && (
            <details className="group mt-2">
              <summary className="cursor-pointer list-none rounded-full [&::-webkit-details-marker]:hidden px-3 py-2 text-center text-sm text-ink-muted transition-colors duration-200 ease-out hover:bg-surface-2 hover:text-ink">
                <span className="group-open:hidden">{`Show ${rest.length} more`}</span>
                <span className="hidden group-open:inline">Show fewer</span>
              </summary>
              <ol className="stagger mt-2 flex flex-col gap-2">
                {rest.map((item) => (
                  <Row key={`${item.kind}-${item.id}`} item={item} now={now} />
                ))}
              </ol>
            </details>
          )}
        </>
      )}
    </section>
  );
}

export function TodayStrip({ data, now }: { data: Today; now: Date }) {
  const day = now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" });
  const stats: [string, number][] = [
    ["Calls", data.calls],
    ["Qualified", data.qualified],
    ["Booked", data.booked],
  ];
  return (
    <section aria-labelledby="today-title" className="rise flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-3xl border border-line bg-surface px-5 py-4 shadow-card sm:px-7">
      <div className="flex items-center gap-2.5">
        <LiveDot />
        <h2 id="today-title" className="text-base font-medium tracking-tight text-ink">
          Today
        </h2>
        <span className="text-xs text-ink-soft">
          {day} · as of {istTime(now).slice(11)} IST
        </span>
      </div>
      <dl className="flex flex-wrap gap-2">
        {stats.map(([label, value]) => (
          <div key={label} className="flex items-baseline gap-2 rounded-full bg-surface-2 px-4 py-1.5">
            <dt className="text-xs text-ink-muted">{label}</dt>
            <dd className="text-lg leading-tight font-light tabular-nums text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
