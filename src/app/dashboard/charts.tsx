// Small server-rendered charts (inline SVG and plain HTML, no chart library, no client JavaScript).
// Line charts stretch to their container with preserveAspectRatio="none" and non-scaling strokes;
// text, dots and tooltips are HTML laid over them, so nothing shrinks or distorts at phone width.
// Every chart prints its numbers next to it or carries them in an accessible label or table.
import type { CSSProperties, ReactNode } from "react";

type Point = [number, number];

// Monotone cubic interpolation (Fritsch-Carlson): smooth, but never overshoots the data.
function monotone(points: Point[]): string {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M${points[0][0]},${points[0][1]}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    dx[i] = points[i + 1][0] - points[i][0];
    slope[i] = (points[i + 1][1] - points[i][1]) / dx[i];
  }
  const tangent: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i += 1) tangent[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  tangent[n - 1] = slope[n - 2];
  for (let i = 0; i < n - 1; i += 1) {
    if (slope[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i] / slope[i];
    const b = tangent[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      tangent[i] = k * a * slope[i];
      tangent[i + 1] = k * b * slope[i];
    }
  }
  const r = (v: number) => Math.round(v * 100) / 100;
  let d = `M${r(points[0][0])},${r(points[0][1])}`;
  for (let i = 0; i < n - 1; i += 1) {
    const h = dx[i] / 3;
    d += ` C${r(points[i][0] + h)},${r(points[i][1] + tangent[i] * h)} ${r(points[i + 1][0] - h)},${r(points[i + 1][1] - tangent[i + 1] * h)} ${r(points[i + 1][0])},${r(points[i + 1][1])}`;
  }
  return d;
}

// Runs of consecutive non-null values, so a missing day breaks the line instead of faking a zero.
function runs(values: (number | null)[], x: (i: number) => number, y: (v: number) => number): Point[][] {
  const out: Point[][] = [];
  let run: Point[] = [];
  values.forEach((value, i) => {
    if (value === null) {
      if (run.length) out.push(run);
      run = [];
    } else run.push([x(i), y(value)]);
  });
  if (run.length) out.push(run);
  return out;
}

const linePath = (parts: Point[][]) => parts.map((pts) => (pts.length === 1 ? `M${pts[0][0] - 0.6},${pts[0][1]} H${pts[0][0] + 0.6}` : monotone(pts))).join(" ");
const areaPath = (parts: Point[][], base: number) =>
  parts
    .filter((pts) => pts.length > 1)
    .map((pts) => `${monotone(pts)} L${pts[pts.length - 1][0]},${base} L${pts[0][0]},${base} Z`)
    .join(" ");

const delay = (seconds: number) => ({ "--d": `${seconds}s` }) as CSSProperties;

// A trend line for the current period over the prior one (dashed), aligned day by day.
export function Sparkline({ id, current, prior, label, legend, start = 0.5 }: { id: string; current: (number | null)[]; prior: (number | null)[]; label: string; legend: [string, string]; start?: number }) {
  const W = 100;
  const H = 40;
  const PAD = 3;
  const n = Math.max(current.length, prior.length);
  const max = Math.max(0, ...[...current, ...prior].filter((v): v is number => v !== null)) * 1.1 || 1;
  const x = (i: number) => (n <= 1 ? W / 2 : (i * W) / (n - 1));
  const y = (v: number) => H - PAD - (v / max) * (H - 2 * PAD);
  const cur = runs(current, x, y);
  const prev = runs(prior, x, y);
  const lastRun = cur[cur.length - 1];
  const last = lastRun?.[lastRun.length - 1];
  return (
    <figure className="m-0">
      <div className="relative h-12">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} className="block h-full w-full overflow-visible">
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: "var(--accent)", stopOpacity: 0.2 }} />
              <stop offset="1" style={{ stopColor: "var(--accent)", stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          <path d={linePath(prev)} fill="none" className="fade stroke-ink-soft" strokeWidth="1.5" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" style={delay(start + 0.2)} />
          <g className="draw" style={delay(start)}>
            <rect width={W} height={H} fill="transparent" />
            <path d={areaPath(cur, H)} fill={`url(#${id})`} />
            <path d={linePath(cur)} fill="none" className="stroke-accent" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </g>
        </svg>
        {last && (
          <span
            aria-hidden="true"
            className="fade absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-surface bg-accent"
            style={{ left: `${(last[0] / W) * 100}%`, top: `${(last[1] / H) * 100}%`, ...delay(start + 1) }}
          />
        )}
      </div>
      <figcaption aria-hidden="true" className="mt-1.5 flex gap-3 text-[11px] text-ink-soft">
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-3 border-t-2 border-accent" />
          {legend[0]}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-3 border-t-2 border-dashed border-ink-soft" />
          {legend[1]}
        </span>
      </figcaption>
    </figure>
  );
}

// 0 and four even steps of 1, 2 or 5 x 10^k that cover `max`.
function ticks(max: number): number[] {
  if (max <= 0) return [0, 1, 2, 3, 4];
  const raw = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude);
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
}

export type ActivityDay = { day: string; label: string; calls: number; qualified: number; booked: number };

// Calls as an area, qualified as a solid line and booked as a dashed line, one point per day.
// Hovering a day shows its numbers; a screen-reader table carries the same data.
export function AreaLineChart({ id, days, split }: { id: string; days: ActivityDay[]; split?: { at: number; before: string; after: string } }) {
  const n = days.length;
  const scale = ticks(Math.max(0, ...days.map((d) => Math.max(d.calls, d.qualified, d.booked))));
  const top = scale[scale.length - 1];
  const PADX = 1.5;
  const x = (i: number) => (n <= 1 ? 50 : PADX + (i * (100 - 2 * PADX)) / (n - 1));
  const y = (v: number) => 100 - (v / top) * 96;
  const series = (key: "calls" | "qualified" | "booked") => runs(days.map((d) => d[key]), x, y);
  const every = Math.max(1, Math.ceil(n / 7));
  const labelled = days.map((_, i) => i).filter((i) => i % every === 0);
  const splitX = split && split.at > 0 && split.at < n ? (x(split.at - 1) + x(split.at)) / 2 : null;
  const half = n <= 1 ? 50 : (100 - 2 * PADX) / (n - 1) / 2;
  return (
    <div>
      <div className="flex gap-2">
        <div aria-hidden="true" className="relative h-56 w-6 shrink-0 text-right text-[11px] text-ink-soft tabular-nums">
          {scale.map((v) => (
            <span key={v} className="absolute right-0 -translate-y-1/2" style={{ top: `${y(v)}%` }}>
              {v}
            </span>
          ))}
        </div>
        <div className="relative h-56 min-w-0 flex-1">
          {scale.map((v) => (
            <span key={v} aria-hidden="true" className={`absolute inset-x-0 border-t ${v === 0 ? "border-line-strong" : "border-dashed border-line"}`} style={{ top: `${y(v)}%` }} />
          ))}
          {splitX !== null && split && (
            <>
              <span aria-hidden="true" className="absolute inset-y-0 border-l border-line-strong" style={{ left: `${splitX}%` }} />
              <span className="absolute top-0 -translate-x-full pr-2 text-[11px] whitespace-nowrap text-ink-soft" style={{ left: `${splitX}%` }}>
                {split.before}
              </span>
              <span className="absolute top-0 pl-2 text-[11px] whitespace-nowrap text-ink-soft" style={{ left: `${splitX}%` }}>
                {split.after}
              </span>
            </>
          )}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 block h-full w-full overflow-visible">
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" style={{ stopColor: "var(--chart-2)", stopOpacity: 0.55 }} />
                <stop offset="1" style={{ stopColor: "var(--chart-2)", stopOpacity: 0.08 }} />
              </linearGradient>
            </defs>
            <path d={areaPath(series("calls"), 100)} fill={`url(#${id})`} className="fade" style={delay(0.9)} />
            <g className="draw" style={delay(0.5)}>
              <rect width="100" height="100" fill="transparent" />
              <path d={linePath(series("calls"))} fill="none" className="stroke-chart-2" strokeWidth="2" vectorEffect="non-scaling-stroke" />
              <path d={linePath(series("booked"))} fill="none" className="stroke-ink-muted" strokeWidth="1.75" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
              <path d={linePath(series("qualified"))} fill="none" className="stroke-accent" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </g>
          </svg>
          {n <= 31 &&
            days.map((d, i) => (
              <span
                key={d.day}
                aria-hidden="true"
                className="fade absolute h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-surface bg-accent"
                style={{ left: `${x(i)}%`, top: `${y(d.qualified)}%`, ...delay(1.1 + i * 0.03) }}
              />
            ))}
          {days.map((d, i) => (
            <div key={d.day} aria-hidden="true" className="group absolute inset-y-0" style={{ left: `${Math.max(0, x(i) - half)}%`, width: `${Math.min(100, half * 2)}%` }}>
              <span className="absolute inset-y-0 left-1/2 border-l border-ink-muted/40 opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
              <span
                className={`pointer-events-none absolute top-6 z-10 rounded-xl bg-ink px-2.5 py-2 text-xs whitespace-nowrap text-canvas opacity-0 shadow-lift transition-opacity duration-150 group-hover:opacity-100 ${x(i) > 60 ? "right-1/2 mr-2" : "left-1/2 ml-2"}`}
              >
                <b className="block font-medium">{d.label}</b>
                {`${d.calls} calls · ${d.qualified} qualified · ${d.booked} booked`}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div aria-hidden="true" className="relative mt-2 ml-8 h-4 text-[11px] text-ink-soft">
        {labelled.map((i, j) => (
          <span key={days[i].day} className={`absolute -translate-x-1/2 whitespace-nowrap ${j % 2 === 1 ? "max-sm:hidden" : ""}`} style={{ left: `${x(i)}%` }}>
            {days[i].label}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Daily calls, qualified enquiries and consultations booked</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Calls</th>
            <th scope="col">Qualified</th>
            <th scope="col">Booked</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.day}>
              <th scope="row">{d.label}</th>
              <td>{d.calls}</td>
              <td>{d.qualified}</td>
              <td>{d.booked}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type Slice = { key: string; label: string; value: number; className: string };

// A ring of segments drawn in turn, with the total in the middle. Labels and numbers live in a legend beside it.
export function Donut({ slices, total, caption, label }: { slices: Slice[]; total: number; caption: string; label: string }) {
  const r = 60;
  const C = 2 * Math.PI * r;
  const gap = slices.filter((s) => s.value > 0).length > 1 ? 2.2 : 0;
  let offset = 0;
  return (
    <div className="relative h-[136px] w-[136px] shrink-0">
      <svg viewBox="0 0 150 150" role="img" aria-label={label} className="h-full w-full -rotate-90">
        <circle cx="75" cy="75" r={r} fill="none" className="stroke-track" strokeWidth="16" />
        {total > 0 &&
          slices.map((s, i) => {
            const length = (s.value / total) * C;
            const el = (
              <circle
                key={s.key}
                cx="75"
                cy="75"
                r={r}
                fill="none"
                className={`seg ${s.className}`}
                strokeWidth="16"
                style={{ strokeDasharray: `${Math.max(length - gap, 0.5)} ${C}`, strokeDashoffset: -offset, ...delay(0.6 + i * 0.09) }}
              />
            );
            offset += length;
            return s.value > 0 ? el : null;
          })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <b className="block text-[28px] leading-none font-semibold tracking-tight text-ink tabular-nums">{total.toLocaleString("en-IN")}</b>
          <span className="text-xs text-ink-muted">{caption}</span>
        </div>
      </div>
    </div>
  );
}

export type FunnelBar = { label: string; value: number; share: number | null; stepRate: number | null };

const percent = (value: number | null) => (value === null ? "–" : `${Math.round(value * 100)}%`);

// Columns scaled to the first stage, each with its share of the first stage and its rate from the stage before.
export function FunnelBars({ steps }: { steps: FunnelBar[] }) {
  const first = steps[0]?.value ?? 0;
  return (
    <div>
      <ol className="grid grid-cols-5 items-end gap-1.5 sm:gap-2.5">
        {steps.map((step, i) => (
          <li key={step.label} className="flex min-w-0 flex-col">
            <span className="text-lg leading-tight font-semibold tracking-tight text-ink tabular-nums">{step.value.toLocaleString("en-IN")}</span>
            <span className="mb-1.5 text-xs text-ink-soft tabular-nums">{percent(step.share)}</span>
            <span
              aria-hidden="true"
              className="relative block h-32 overflow-hidden rounded-xl border border-line"
              style={{ background: "repeating-linear-gradient(135deg, var(--track) 0 6px, var(--surface-2) 6px 12px)" }}
            >
              <span
                className="grow-y absolute inset-x-0 bottom-0 rounded-t-[10px] bg-accent"
                style={{ height: `${first > 0 ? (step.value / first) * 100 : 0}%`, opacity: 1 - i * 0.14, ...({ "--stagger": i + 2 } as CSSProperties) }}
              />
            </span>
            <span className="mt-2 truncate text-xs font-medium text-ink-muted">{step.label}</span>
          </li>
        ))}
      </ol>
      <div className="mt-3 grid grid-cols-5 gap-1.5 text-xs text-ink-muted sm:gap-2.5">
        <span className="self-center">Step rate</span>
        {steps.slice(1).map((step, i) => (
          <span key={step.label} className="self-center">
            <span className="sr-only">{`${steps[i].label} to ${step.label}: `}</span>
            <span className="inline-flex rounded-lg bg-accent-soft px-1.5 py-0.5 font-semibold text-accent-soft-ink tabular-nums">{percent(step.stepRate)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export type Tick = { key: string; className: string; title: string };

// One tick per item, oldest on the left; colour carries the category, the legend carries the counts.
export function Tracker({ ticks: items, label }: { ticks: Tick[]; label: string }) {
  return (
    <div role="img" aria-label={label} className="flex h-9 gap-1">
      {items.map((tick, i) => (
        <span key={tick.key} title={tick.title} className={`pop min-w-0 flex-1 rounded-md ${tick.className}`} style={delay(0.8 + i * 0.05)} />
      ))}
    </div>
  );
}

export type Category = { key: string; label: string; value: number; className: string; display: ReactNode };

// A split bar with a legend that prints every amount. Zero amounts stay in the legend, not in the bar.
export function CategoryBar({ parts, total }: { parts: Category[]; total: number }) {
  const visible = parts.filter((p) => p.value > 0);
  return (
    <div>
      <div aria-hidden="true" className="flex h-2 gap-[3px]">
        {total > 0 ? (
          visible.map((p, i) => <span key={p.key} className={`grow-x rounded-full ${p.className}`} style={{ flex: `${Math.max((p.value / total) * 100, 2.5)} 0 0`, animationDelay: `${0.6 + i * 0.08}s` }} />)
        ) : (
          <span className="flex-1 rounded-full bg-track" />
        )}
      </div>
      <dl className="mt-2.5 grid gap-1 text-xs text-ink-muted">
        {parts.map((p) => (
          <div key={p.key} className="flex items-center gap-2">
            <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-[3px] ${p.className}`} />
            <dt className="min-w-0 truncate">{p.label}</dt>
            <dd className="ml-auto font-medium text-ink tabular-nums">{p.display}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
