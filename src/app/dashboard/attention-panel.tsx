import Link from "next/link";
import type { AttentionItem } from "@/lib/dashboard/attention";
import { Badge, istTime, LiveDot, relTime } from "./ui";

// How many items show before the rest fold under "Show more" (a plain <details>, no JavaScript).
const VISIBLE = 8;

const TONE_BAR = { danger: "bg-danger", warn: "bg-warn", info: "bg-accent" };
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

const Clock = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

function Row({ item, now }: { item: AttentionItem; now: Date }) {
  const consult = item.kind === "consult_today" || item.kind === "consult_tomorrow";
  const body = (
    <>
      <span aria-hidden="true" className={`row-span-2 w-1 self-stretch rounded-full sm:row-span-1 ${TONE_BAR[item.tone]}`} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[13.5px] font-semibold break-words text-ink">{item.title}</span>
        <span className="text-xs break-words text-ink-muted">{item.detail}</span>
      </span>
      <span className="col-start-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted sm:col-start-auto sm:justify-end">
        <Badge tone={item.tone}>{TONE_LABEL[item.tone]}</Badge>
        <span className="inline-flex items-center gap-1 whitespace-nowrap tabular-nums">
          <Clock />
          {when(item, now)}
        </span>
      </span>
      {item.callId && (
        <span aria-hidden="true" className="hidden rounded-[10px] border border-line bg-surface px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-accent transition-colors duration-200 group-hover/row:border-line-strong sm:inline">
          {consult ? "View" : "Open"}
        </span>
      )}
    </>
  );
  const shell = "grid grid-cols-[4px_minmax(0,1fr)] items-center gap-x-3.5 gap-y-1.5 rounded-2xl border border-line bg-surface-2 py-2.5 pr-3 pl-3 sm:grid-cols-[4px_minmax(0,1fr)_auto_auto] sm:py-3";
  return (
    <li>
      {item.callId ? (
        <Link href={`/dashboard/calls/${item.callId}`} className={`lift group/row ${shell}`}>
          {body}
        </Link>
      ) : (
        <div className={shell}>{body}</div>
      )}
    </li>
  );
}

export function AttentionPanel({ items, now, className = "" }: { items: AttentionItem[]; now: Date; className?: string }) {
  const urgent = items.filter((item) => item.tone === "danger").length;
  const shown = items.slice(0, VISIBLE);
  const rest = items.slice(VISIBLE);
  return (
    <section aria-labelledby="attention-title" className={`relative min-w-0 rounded-3xl border border-line bg-surface p-5 shadow-card sm:p-6 ${urgent > 0 ? "beam" : ""} ${className}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h2 id="attention-title" className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-ink">
            {urgent > 0 && <LiveDot tone="danger" />}
            Needs attention
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">Things the front desk could not finish on its own</p>
        </div>
        {items.length > 0 && (
          <span className={`inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${urgent > 0 ? "shimmer bg-danger-bg text-danger" : "bg-surface-2 text-ink-muted"}`}>
            {urgent > 0 ? `${urgent} urgent · ${items.length} open` : `${items.length} open`}
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
