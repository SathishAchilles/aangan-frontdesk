import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type { Range } from "@/lib/dashboard/metrics";

// Shared class strings so forms and buttons look the same on every page.
export const inputClass = "rounded-full border border-line bg-surface-2 px-4 py-2 text-sm text-ink transition-colors duration-200 ease-out placeholder:text-ink-soft hover:border-line-strong focus-visible:border-accent";
export const buttonPrimary = "rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink shadow-card transition duration-200 ease-out hover:opacity-90 hover:shadow-lift motion-safe:active:scale-[0.97]";
export const buttonSecondary = "rounded-full border border-line bg-surface px-4 py-2 text-sm text-ink transition duration-200 ease-out hover:border-line-strong hover:bg-surface-2 motion-safe:active:scale-[0.97]";

export function PageHeader({ title, eyebrow, children, mono = false }: { title: ReactNode; eyebrow?: ReactNode; children?: ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow && <div className="text-sm text-ink-soft">{eyebrow}</div>}
        <h1 className={`break-words text-ink ${mono ? "font-mono text-2xl font-normal break-all" : "text-3xl font-light tracking-tight"}`}>{title}</h1>
      </div>
      {children}
    </div>
  );
}

export function Notice({ tone, children }: { tone: "ok" | "danger" | "warn"; children: ReactNode }) {
  const tones = { ok: "bg-ok-bg text-ok", danger: "bg-danger-bg text-danger", warn: "bg-warn-bg text-warn" };
  return <p className={`rounded-2xl px-4 py-3 text-sm font-medium ${tones[tone]}`}>{children}</p>;
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "ok" | "danger" | "warn" | "info" | "accent"; children: ReactNode }) {
  const tones = {
    neutral: "bg-surface-2 text-ink-muted",
    ok: "bg-ok-bg text-ok",
    danger: "bg-danger-bg text-danger",
    warn: "bg-warn-bg text-warn",
    info: "bg-info-bg text-info",
    accent: "bg-accent-soft text-accent-soft-ink",
  };
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Card({ title, children, className = "", action }: { title?: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={`min-w-0 rounded-3xl border border-line bg-surface p-5 shadow-card transition-[border-color,box-shadow] duration-200 ease-out hover:border-line-strong sm:p-7 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-base font-medium tracking-tight text-ink">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

// A thin progress track, like the balance bar in the reference. Decorative: the number is always printed beside it.
export function Meter({ value, max, tone = "accent", className = "" }: { value: number; max: number; tone?: "accent" | "inverse"; className?: string }) {
  const share = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <span aria-hidden="true" className={`block h-1 w-full overflow-hidden rounded-full ${tone === "accent" ? "bg-track" : "bg-accent-ink/20"} ${className}`}>
      <span className={`grow-x block h-full rounded-full ${tone === "accent" ? "bg-accent" : "bg-accent-ink/75"}`} style={{ width: `${(share * 100).toFixed(1)}%` }} />
    </span>
  );
}

// A number with a bar scaled against the largest value in its column.
export function MeterCell({ value, max, children }: { value: number; max: number; children?: ReactNode }) {
  return (
    <span className="flex min-w-32 items-center gap-3">
      <span className="min-w-16 shrink-0 tabular-nums whitespace-nowrap">{children ?? value}</span>
      <Meter value={value} max={max} className="min-w-16 flex-1" />
    </span>
  );
}

// Server-rendered column chart for a handful of labelled counts. Bars are scaled to the largest value.
export function ColumnChart({ data, label }: { data: { label: string; value: number }[]; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const width = 560;
  const height = 190;
  const top = 20;
  const base = 160;
  const slot = width / data.length;
  const bar = Math.min(44, slot * 0.42);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}: ${data.map((d) => `${d.label} ${d.value}`).join(", ")}`} className="mb-2 hidden h-auto w-full sm:block">
      {[0, 1, 2, 3].map((row) =>
        Array.from({ length: data.length + 1 }, (_, col) => (
          <text key={`${row}-${col}`} x={Math.min(width - 4, Math.max(4, col * slot))} y={top + ((base - top) / 3) * row + 3} textAnchor="middle" className="fill-ink-soft" fontSize="10" opacity="0.45">
            +
          </text>
        )),
      )}
      {data.map((d, i) => {
        const h = Math.max(2, ((base - top) * d.value) / max);
        const x = i * slot + (slot - bar) / 2;
        return (
          <g key={d.label}>
            <rect x={x} y={base - h} width={bar} height={h} rx={8} className={`grow-y ${i === 0 ? "fill-chart-2" : "fill-accent"}`} style={{ "--stagger": i } as CSSProperties} />
            <text x={x + bar / 2} y={base - h - 5} textAnchor="middle" className="rise fill-ink" fontSize="13" style={{ "--stagger": i + 4 } as CSSProperties}>
              {d.value}
            </text>
            <text x={x + bar / 2} y={base + 18} textAnchor="middle" className="fill-ink-soft" fontSize="12">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const ArrowIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 11 11 5M6 5h5v5" />
  </svg>
);

export function Stat({
  label,
  value,
  hint,
  href,
  tone = "default",
  meter,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  href?: string;
  tone?: "default" | "accent";
  meter?: { value: number; max: number };
}) {
  const accent = tone === "accent";
  const body = (
    <div className={`flex h-full flex-col gap-2.5 rounded-3xl border p-5 shadow-card sm:p-6 ${accent ? "border-transparent bg-accent text-accent-ink" : "border-line bg-surface text-ink"} ${href ? "lift" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className={`text-sm ${accent ? "text-accent-ink/85" : "text-ink-muted"}`}>{label}</div>
        {href && (
          <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full transition duration-200 ease-out motion-safe:group-hover:rotate-45 ${accent ? "bg-accent-ink/15" : "bg-surface-2 text-ink-muted group-hover:bg-accent group-hover:text-accent-ink"}`}>
            <ArrowIcon />
          </span>
        )}
      </div>
      <div className="text-[1.75rem] leading-tight font-light tracking-tight tabular-nums">{value}</div>
      {meter && <Meter value={meter.value} max={meter.max} tone={accent ? "inverse" : "accent"} />}
      {hint && <div className={`mt-auto text-xs ${accent ? "text-accent-ink/85" : "text-ink-soft"}`}>{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="group block rounded-3xl">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Table({ head, rows, empty = "Nothing here yet." }: { head: string[]; rows: ReactNode[][]; empty?: string }) {
  if (rows.length === 0) return <p className="rounded-2xl bg-surface-2 px-4 py-6 text-center text-sm text-ink-soft">{empty}</p>;
  return (
    <div className="-mx-3 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-wider text-ink-soft">
            {head.map((cell) => (
              <th key={cell} scope="col" className="py-2.5 pr-4 font-medium whitespace-nowrap first:pl-3 last:pr-3">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-line transition-colors duration-150 ease-out last:border-b-0 hover:bg-surface-2">
              {row.map((cell, j) => (
                <td key={j} className="py-3 pr-4 align-top tabular-nums text-ink first:pl-3 last:pr-3">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RangePicker({ range, path }: { range: Range; path: string }) {
  return (
    <form action={path} className="flex flex-wrap items-end gap-2 text-sm">
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        From
        <input type="date" name="from" defaultValue={range.from} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        To (exclusive)
        <input type="date" name="to" defaultValue={range.to} className={inputClass} />
      </label>
      <button className={buttonPrimary}>Apply</button>
    </form>
  );
}

// A status dot with a soft pulsing halo, for things that update as calls come in. Decorative.
export function LiveDot({ tone = "ok" }: { tone?: "ok" | "danger" | "warn" | "accent" }) {
  const fill = { ok: "bg-ok", danger: "bg-danger", warn: "bg-warn", accent: "bg-accent" }[tone];
  return (
    <span aria-hidden="true" className="relative inline-flex h-2 w-2 shrink-0">
      <span className={`live-ring absolute inset-0 rounded-full ${fill}`} />
      <span className={`relative inline-flex h-2 w-2 rounded-full ${fill}`} />
    </span>
  );
}

// "12 min ago" / "in 40 min", relative to the time the page was rendered.
export function relTime(date: Date | null, now: Date): string {
  if (!date) return "";
  const diff = Math.round((now.getTime() - date.getTime()) / 60_000);
  const span = Math.abs(diff);
  const words = span < 1 ? null : span < 60 ? `${span} min` : span < 48 * 60 ? `${Math.round(span / 60)} h` : `${Math.round(span / 1440)} d`;
  if (!words) return "just now";
  return diff >= 0 ? `${words} ago` : `in ${words}`;
}

export const inr = (value: number | null | undefined) =>
  value === null || value === undefined ? "-" : `₹${value.toLocaleString("en-IN", { maximumFractionDigits: value < 100 ? 2 : 0 })}`;
export const pct = (value: number | null | undefined) => (value === null || value === undefined ? "-" : `${Math.round(value * 100)}%`);
export const istTime = (date: Date | null) =>
  date ? new Date(date.getTime() + 330 * 60_000).toISOString().replace("T", " ").slice(0, 16) : "-";

export const OUTCOME_LABEL: Record<string, string> = {
  QUALIFIED: "Qualified",
  QUALIFIED_WITH_NOTES: "Qualified, with notes",
  NOT_QUALIFIED: "Not qualified",
  NEEDS_HUMAN: "Needs a person",
  NOT_ENQUIRY: "Not an enquiry",
  PENDING: "Pending (call ended early)",
};
export const CRITERION_LABEL: Record<string, string> = { C1: "Real project", C2: "Service area", C3: "Timeline", C4: "Budget", C5: "Decision-maker" };

export const OUTCOME_TONE: Record<string, "ok" | "danger" | "warn" | "neutral"> = {
  QUALIFIED: "ok",
  QUALIFIED_WITH_NOTES: "ok",
  NOT_QUALIFIED: "neutral",
  NEEDS_HUMAN: "warn",
  NOT_ENQUIRY: "neutral",
  PENDING: "neutral",
};
