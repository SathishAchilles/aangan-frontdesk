// Pieces shared by the designer pages. They build on the dashboard's components and tokens so the
// two areas look like one product.
import Link from "next/link";
import type { ReactNode } from "react";
import type { DesignerView } from "@/lib/designer/access";
import { withAs } from "@/lib/designer/links";
import type { NoteView } from "@/lib/designer/note";
import { delta, type Kpi } from "@/lib/designer/performance";
import { Badge, buttonPrimary, buttonSecondary, pct } from "../dashboard/ui";
import { acceptHandoffAction, recordResultAction } from "./actions";
import { PendingButton } from "./pending-button";

const IST = { timeZone: "Asia/Kolkata" } as const;
export const istHm = (date: Date) => date.toLocaleTimeString("en-GB", { ...IST, hour: "2-digit", minute: "2-digit", hour12: false });
export const istDay = (date: Date) => date.toLocaleDateString("en-IN", { ...IST, weekday: "short", day: "numeric", month: "short" });
export const istWhen = (date: Date) => `${istDay(date)}, ${istHm(date)}`;
export const firstName = (name: string) => name.replace(/\s*\(.*\)\s*$/, "").split(/\s+/)[0] || name;

export const CONSULT_LABEL: Record<string, string> = { studio: "Studio consultation", site: "Site visit", principal: "Principal visit" };

// One line of feedback after an action, read from ?done= on the page the action returned to.
const NOTICES: Record<string, { tone: "ok" | "warn" | "danger"; text: (by?: string) => string }> = {
  accepted: { tone: "ok", text: () => "Accepted. It's yours: the Telegram message now shows it too." },
  taken: { tone: "warn", text: (by) => `Already accepted by ${by ?? "someone else"}.` },
  won: { tone: "ok", text: () => "Recorded as won. Congratulations." },
  lost: { tone: "ok", text: () => "Recorded as lost." },
  "already-recorded": { tone: "warn", text: () => "A result was already recorded for this enquiry." },
  "not-allowed": { tone: "danger", text: () => "That action is not open to you for this enquiry." },
};

export function Flash({ done, by }: { done?: string; by?: string }) {
  const notice = done ? NOTICES[done] : undefined;
  if (!notice) return null;
  const tones = { ok: "bg-ok-bg text-ok", warn: "bg-warn-bg text-warn", danger: "bg-danger-bg text-danger" };
  return (
    <p role="status" className={`rise rounded-2xl px-4 py-3 text-sm font-medium ${tones[notice.tone]}`}>
      {notice.text(by)}
    </p>
  );
}

export function ViewAsBanner({ view }: { view: DesignerView }) {
  if (!view.readOnly) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-info-bg px-4 py-3 text-sm text-info">
      <p>
        <span className="font-medium">Viewing as {view.designer.name}, read-only.</span> Accept and Won/Lost are disabled here; only {firstName(view.designer.name)} can use them. Phone
        numbers stay masked.
      </p>
      <span className="flex gap-2">
        <Link href="/designer/view-as" className="rounded-full border border-current/30 px-3 py-1 font-medium hover:bg-surface/60">
          Switch designer
        </Link>
        <Link href="/dashboard" className="rounded-full border border-current/30 px-3 py-1 font-medium hover:bg-surface/60">
          Admin dashboard
        </Link>
      </span>
    </div>
  );
}

export function SectionTitle({ title, hint, action }: { title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="text-base font-medium tracking-tight text-ink">{title}</h2>
        {hint && <p className="text-sm text-ink-soft">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-line bg-surface-2 px-4 py-6 text-center text-sm text-ink-soft">{children}</p>;
}

const disabledButton = "cursor-not-allowed rounded-full border border-line bg-surface-2 px-4 py-2 text-sm text-ink-soft";

export function AcceptButton({ handoffId, back, readOnly, compact = false }: { handoffId: string; back: string; readOnly: boolean; compact?: boolean }) {
  if (readOnly)
    return (
      <button type="button" disabled className={disabledButton} title="Read-only while viewing as a designer">
        Accept
      </button>
    );
  return (
    <form action={acceptHandoffAction}>
      <input type="hidden" name="handoff" value={handoffId} />
      <input type="hidden" name="back" value={back} />
      <PendingButton pendingText="Accepting…" className={`${buttonPrimary} ${compact ? "px-3.5 py-1.5" : ""}`}>
        Accept
      </PendingButton>
    </form>
  );
}

export function ResultButtons({ enquiryId, back, readOnly }: { enquiryId: string; back: string; readOnly: boolean }) {
  if (readOnly)
    return (
      <div className="flex gap-2">
        <button type="button" disabled className={disabledButton}>
          Won
        </button>
        <button type="button" disabled className={disabledButton}>
          Lost
        </button>
      </div>
    );
  return (
    <form action={recordResultAction} className="flex flex-wrap gap-2">
      <input type="hidden" name="enquiry" value={enquiryId} />
      <input type="hidden" name="back" value={back} />
      <PendingButton name="result" value="won" pendingText="Saving…" className={buttonPrimary}>
        Won
      </PendingButton>
      <PendingButton name="result" value="lost" pendingText="Saving…" className={buttonSecondary}>
        Lost
      </PendingButton>
    </form>
  );
}

export function ResultBadge({ result }: { result: "won" | "lost" | null }) {
  if (result === "won") return <Badge tone="ok">Won</Badge>;
  if (result === "lost") return <Badge tone="neutral">Lost</Badge>;
  return null;
}

const CHECK_MARK: Record<string, { label: string; className: string; path: string }> = {
  pass: { label: "confirmed", className: "bg-ok-bg text-ok", path: "M4 8.5 6.5 11 12 5.5" },
  fail: { label: "not met", className: "bg-danger-bg text-danger", path: "M5 5l6 6M11 5l-6 6" },
  unclear: { label: "unclear", className: "bg-warn-bg text-warn", path: "M6.2 6a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.2M8 11.5v.01" },
  not_mentioned: { label: "not discussed", className: "bg-surface-2 text-ink-soft", path: "M5 8h6" },
};

// The handoff note, laid out for reading before a call: the one-line summary, the facts, what to
// watch out for, and how the qualifying checks came out.
export function NoteCard({ note }: { note: NoteView }) {
  return (
    <div className="flex flex-col gap-5">
      {note.summary && <p className="rounded-2xl border-l-[3px] border-accent bg-accent-soft px-4 py-3 text-[0.9375rem] leading-relaxed text-accent-soft-ink">{note.summary}</p>}
      {note.fields.length > 0 && (
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {note.fields.map((field) => (
            <div key={field.label} className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-xs tracking-wider text-ink-soft uppercase">{field.label}</dt>
              <dd className="break-words text-sm text-ink">{field.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {note.watchOuts.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs tracking-wider text-ink-soft uppercase">Watch out for</h3>
          <ul className="flex flex-wrap gap-2">
            {note.watchOuts.map((item) => (
              <li key={item} className="rounded-full bg-warn-bg px-3 py-1 text-xs font-medium text-warn">
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
      {note.checks.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs tracking-wider text-ink-soft uppercase">Checks on the call</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {note.checks.map((check) => {
              const mark = CHECK_MARK[check.state] ?? CHECK_MARK.not_mentioned;
              return (
                <li key={check.id} className="flex items-center gap-2.5 text-sm text-ink">
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${mark.className}`}>
                    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d={mark.path} />
                    </svg>
                  </span>
                  {check.label}
                  <span className="text-ink-soft">· {mark.label}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// Two lines over the same buckets: the designer (solid, filled) and the studio average (dashed).
// Gaps in a series (no data that day) break the line rather than drawing a false zero.
export function Sparkline({ mine, studio, label }: { mine: (number | null)[]; studio: (number | null)[]; label: string }) {
  const width = 240;
  const height = 64;
  const pad = 4;
  const values = [...mine, ...studio].filter((value): value is number => value !== null);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const n = Math.max(mine.length, studio.length);
  const x = (i: number) => (n <= 1 ? width / 2 : pad + (i * (width - pad * 2)) / (n - 1));
  const y = (value: number) => height - pad - ((value - min) / span) * (height - pad * 2);
  const path = (series: (number | null)[]) => {
    let d = "";
    let open = false;
    series.forEach((value, i) => {
      if (value === null) {
        open = false;
        return;
      }
      d += `${open ? "L" : "M"}${x(i).toFixed(1)} ${y(value).toFixed(1)}`;
      open = true;
    });
    return d;
  };
  const points = mine.map((value, i) => (value === null ? null : ([x(i), y(value)] as const))).filter((p): p is readonly [number, number] => p !== null);
  const area = points.length > 1 ? `M${points[0][0].toFixed(1)} ${height - pad}${points.map(([px, py]) => `L${px.toFixed(1)} ${py.toFixed(1)}`).join("")}L${points[points.length - 1][0].toFixed(1)} ${height - pad}Z` : "";
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="h-16 w-full overflow-visible" preserveAspectRatio="none">
      {area && <path d={area} className="fill-accent/10" />}
      <path d={path(studio)} fill="none" className="stroke-ink-soft" strokeWidth="1.5" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      <path d={path(mine)} fill="none" className="stroke-accent" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {last && <circle cx={last[0]} cy={last[1]} r="3" className="fill-accent" />}
    </svg>
  );
}

const showValue = (kpi: Pick<Kpi, "unit">, value: number | null) =>
  value === null ? "–" : kpi.unit === "pct" ? pct(value) : kpi.unit === "min" ? `${value} min` : Number.isInteger(value) ? String(value) : value.toFixed(1);

function DeltaPill({ kpi }: { kpi: Kpi }) {
  const gap = delta(kpi);
  if (!gap) return null;
  const tones = { ok: "bg-ok-bg text-ok", danger: "bg-danger-bg text-danger", neutral: "bg-surface-2 text-ink-muted" };
  const arrow = gap.direction === "up" ? "M8 12V4M4.5 7.5 8 4l3.5 3.5" : gap.direction === "down" ? "M8 4v8M4.5 8.5 8 12l3.5-3.5" : "M4 8h8";
  const words = gap.direction === "flat" ? "level with the studio" : `${gap.text} ${gap.direction === "up" ? "above" : "below"} the studio, ${gap.tone === "ok" ? "better" : "worse"}`;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums ${tones[gap.tone]}`}>
      <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={arrow} />
      </svg>
      <span aria-hidden="true">{gap.direction === "flat" ? "level" : gap.text}</span>
      <span className="sr-only">{words}</span>
    </span>
  );
}

export function KpiCard({ kpi, period, studioHint }: { kpi: Kpi; period: string; studioHint: string }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-3xl border border-line bg-surface p-5 shadow-card transition-[border-color,box-shadow] duration-200 ease-out hover:border-line-strong">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm text-ink-muted">{kpi.label}</h2>
        <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[0.6875rem] text-ink-soft">{period}</span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-[2rem] leading-none font-light tracking-tight text-ink tabular-nums">{showValue(kpi, kpi.mine)}</span>
        <DeltaPill kpi={kpi} />
      </div>
      <p className="text-xs text-ink-soft">
        Studio {studioHint} <span className="font-medium text-ink-muted tabular-nums">{showValue(kpi, kpi.studio)}</span>
      </p>
      <Sparkline mine={kpi.series.mine} studio={kpi.series.studio} label={`${kpi.label}: you ${showValue(kpi, kpi.mine)}, studio ${showValue(kpi, kpi.studio)}`} />
      <div aria-hidden="true" className="flex items-center gap-4 text-[0.6875rem] text-ink-soft">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-accent" />
          You
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0 w-4 border-t-[1.5px] border-dashed border-ink-soft" />
          Studio
        </span>
      </div>
    </section>
  );
}

// Pill links that keep the admin's `as` on every hop.
export function PillLinks({ items, active, as }: { items: [href: string, label: string, key: string][]; active: string; as: string | null }) {
  return (
    <nav aria-label="Filter" className="-mx-1 flex max-w-full gap-2 overflow-x-auto px-1 pb-1">
      {items.map(([href, label, key]) => (
        <Link
          key={key}
          href={withAs(href, as)}
          aria-current={active === key ? "page" : undefined}
          className={`inline-flex shrink-0 items-center rounded-full px-3.5 py-1.5 text-sm whitespace-nowrap transition ${
            active === key ? "border border-transparent bg-accent text-accent-ink" : "border border-line bg-surface text-ink-muted hover:bg-surface-2 hover:text-ink"
          }`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
