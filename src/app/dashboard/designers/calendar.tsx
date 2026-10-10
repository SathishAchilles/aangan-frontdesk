// Consultation calendar for the designers page. Server-rendered: navigation is plain links with
// search params, and the extra detail on a meeting opens on hover or keyboard focus with CSS only.
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { addDays, istDate, istMinutes, istStart, mondayOf, placeOverlaps, validDate, validUuid, type ConsultType, type Meeting } from "@/lib/dashboard/schedule";

export const DAY_START_MIN = 9 * 60;
export const DAY_END_MIN = 20 * 60;
const SLOT_MIN = 30;
const SLOTS = (DAY_END_MIN - DAY_START_MIN) / SLOT_MIN;
const SLOT_REM = 2.5;
const GRID_REM = SLOTS * SLOT_REM;
// Percent of a column each overlapping lane is shifted right, so an earlier meeting stays visible.
const MIN_CASCADE_STEP = 22;

export type CalendarParams = { view?: string; week?: string; date?: string; designer?: string; from?: string; to?: string };
export type CalendarView = { view: "week" | "day"; start: string; end: string; days: string[]; designer?: string; today: string };

// Reads the calendar's search params. Anything malformed falls back to the current IST week or day.
export function parseCalendar(params: CalendarParams, now: Date): CalendarView {
  const today = istDate(now);
  const designer = validUuid(params.designer);
  if (params.view === "day") {
    const date = validDate(params.date) ?? validDate(params.week) ?? today;
    return { view: "day", start: date, end: addDays(date, 1), days: [date], designer, today };
  }
  const monday = mondayOf(validDate(params.week) ?? validDate(params.date) ?? today);
  return { view: "week", start: monday, end: addDays(monday, 7), days: Array.from({ length: 7 }, (_, i) => addDays(monday, i)), designer, today };
}

// One muted tint per designer, mixed from the palette tokens so it follows light and dark mode.
const TINT_TOKENS = ["--accent", "--info", "--ok", "--warn", "--chart-2"] as const;
type Tint = { bg: string; edge: string; swatch: string };
const tintFor = (index: number): Tint => {
  const token = TINT_TOKENS[index % TINT_TOKENS.length];
  return {
    bg: `color-mix(in oklab, var(${token}) 16%, var(--surface))`,
    edge: `color-mix(in oklab, var(${token}) 72%, var(--surface))`,
    swatch: `color-mix(in oklab, var(${token}) 60%, var(--surface))`,
  };
};
const UNASSIGNED_TINT: Tint = { bg: "var(--surface-2)", edge: "var(--ink-soft)", swatch: "var(--ink-soft)" };

export type DesignerRef = { id: string; name: string };

const TYPE_LABEL: Record<ConsultType, string> = { studio: "Studio", site: "Site visit", principal: "Principal visit" };

function TypeIcon({ type, className = "h-3.5 w-3.5" }: { type: ConsultType; className?: string }) {
  const common = { "aria-hidden": true, viewBox: "0 0 16 16", className, fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (type === "site")
    return (
      <svg {...common}>
        <path d="M8 14.5s4.5-4.2 4.5-8A4.5 4.5 0 0 0 3.5 6.5c0 3.8 4.5 8 4.5 8Z" />
        <circle cx="8" cy="6.5" r="1.6" />
      </svg>
    );
  if (type === "principal")
    return (
      <svg {...common}>
        <path d="m8 2 1.8 3.7 4 .6-2.9 2.8.7 4L8 11.2 4.4 13.1l.7-4-2.9-2.8 4-.6Z" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M2.5 13.5h11M4 13.5V3.5h8v10M6.5 6h1M8.5 6h1M6.5 8.5h1M8.5 8.5h1M7 13.5v-2h2v2" />
    </svg>
  );
}

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const span = (meeting: Meeting) => {
  const start = istMinutes(meeting.start);
  const end = Math.min(24 * 60, Math.round((meeting.end.getTime() - istStart(meeting.day).getTime()) / 60_000));
  return { start, end };
};
const timeRange = (meeting: Meeting) => {
  const { start, end } = span(meeting);
  return `${hhmm(start)}–${hhmm(end)}`;
};
const dayLabel = (date: string, options: Intl.DateTimeFormatOptions) => new Date(`${date}T12:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", ...options });

function href(params: CalendarParams, change: Partial<Record<keyof CalendarParams, string | undefined>>) {
  const merged: Record<string, string | undefined> = { from: params.from, to: params.to, view: params.view, week: params.week, date: params.date, designer: params.designer, ...change };
  const query = Object.entries(merged)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${encodeURIComponent(value as string)}`)
    .join("&");
  return `/dashboard/designers${query ? `?${query}` : ""}#schedule`;
}

const pill = "inline-flex items-center rounded-full px-3.5 py-1.5 text-sm whitespace-nowrap transition";
const pillIdle = `${pill} border border-line bg-surface text-ink-muted hover:bg-surface-2 hover:text-ink`;
const pillActive = `${pill} border border-transparent bg-accent text-accent-ink`;

function RescheduledIcon() {
  return (
    <svg role="img" aria-label="rescheduled" viewBox="0 0 16 16" className="h-3 w-3 shrink-0 text-warn" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 8a5 5 0 0 1-8.6 3.5M3 8a5 5 0 0 1 8.6-3.5M11.8 2v2.6H9.2M4.2 14v-2.6h2.6" />
    </svg>
  );
}

function StatusTag({ status }: { status: Meeting["status"] }) {
  if (status === "rescheduled") return <span className="rounded-full bg-warn-bg px-1.5 py-px text-[0.6875rem] font-medium text-warn">Rescheduled</span>;
  if (status === "cancelled") return <span className="rounded-full bg-surface px-1.5 py-px text-[0.6875rem] font-medium text-ink-soft no-underline">Cancelled</span>;
  return null;
}

// The detail card shown on hover or focus: everything useful before the visit, and nothing priced.
function Details({ meeting, tint, placement }: { meeting: Meeting; tint: Tint; placement: string }) {
  return (
    <span
      className={`pointer-events-none absolute z-30 hidden w-64 flex-col gap-1.5 rounded-2xl border border-line bg-surface p-3.5 text-left text-xs leading-snug text-ink no-underline shadow-card group-hover:flex group-focus-visible:flex ${placement}`}
    >
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: tint.swatch }} />
        <span className="truncate text-sm font-medium">{meeting.caller_name ?? "Unknown caller"}</span>
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-muted">
        <span className="tabular-nums">{dayLabel(meeting.day, { weekday: "short", day: "numeric", month: "short" })} · {timeRange(meeting)}</span>
        <StatusTag status={meeting.status} />
      </span>
      <span className="flex items-center gap-1.5 text-ink-muted">
        <TypeIcon type={meeting.consult_type} />
        {TYPE_LABEL[meeting.consult_type]} with {meeting.designer_name ?? "no designer yet"}
      </span>
      {meeting.locality && <span className="text-ink-muted">{meeting.locality}</span>}
      {meeting.scope && <span className="text-ink">{meeting.scope}</span>}
      {meeting.phone_masked && <span className="font-mono text-ink-muted">{meeting.phone_masked}</span>}
      <span className="pt-0.5 font-medium text-accent">{meeting.call_id ? "Open the enquiry call →" : "No call recorded for this enquiry"}</span>
    </span>
  );
}

function Block({ meeting, tint, lane, lanes, placement }: { meeting: Meeting; tint: Tint; lane: number; lanes: number; placement: string }) {
  const { start, end } = span(meeting);
  const top = Math.max(start, DAY_START_MIN);
  const bottom = Math.max(top + SLOT_MIN, Math.min(end, DAY_END_MIN));
  const total = DAY_END_MIN - DAY_START_MIN;
  const short = bottom - top <= SLOT_MIN;
  const cancelled = meeting.status === "cancelled";
  // Overlaps cascade: each later lane starts further right and sits on top, but is wider than an
  // equal split so names stay legible; the earlier meeting's header stays visible above it.
  const width = lanes > 1 ? Math.max(100 / lanes, Math.min((100 / lanes) * 1.7, 100 - (lanes - 1) * MIN_CASCADE_STEP)) : 100;
  const left = lanes > 1 ? (lane * (100 - width)) / (lanes - 1) : 0;
  const style: CSSProperties & Record<`--${string}`, string> = {
    top: `${((top - DAY_START_MIN) / total) * 100}%`,
    height: `calc(${((bottom - top) / total) * 100}% - 2px)`,
    left: `calc(${left}% + 2px)`,
    width: `calc(${width}% - 4px)`,
    zIndex: lane + 1,
    "--tint-bg": cancelled ? "var(--surface)" : tint.bg,
    "--tint-edge": cancelled ? "var(--line)" : tint.edge,
  };
  // Narrow lanes (overlaps) keep the essentials: icon, start time, first name.
  const narrow = lanes > 1;
  const name = meeting.caller_name ?? "Unknown caller";
  const shownName = narrow ? name.split(" ")[0] : name;
  const nameClass = cancelled ? "text-ink-soft line-through" : "text-ink";
  const body = (
    <>
      <span className="flex h-full min-w-0 flex-col overflow-hidden leading-4">
        <span className="flex min-w-0 shrink-0 items-center gap-1 text-[0.6875rem] text-ink-muted">
          <TypeIcon type={meeting.consult_type} className="h-3 w-3 shrink-0" />
          <span className="sr-only">{TYPE_LABEL[meeting.consult_type]},</span>
          <span className="shrink-0 tabular-nums">{narrow ? hhmm(start) : timeRange(meeting)}</span>
          {meeting.status === "rescheduled" && <RescheduledIcon />}
          {cancelled && <span className="sr-only">cancelled,</span>}
          {short && <span className={`ml-0.5 truncate font-medium ${nameClass}`}>{shownName}</span>}
        </span>
        {!short && <span className={`mt-0.5 shrink-0 truncate text-[0.8125rem] font-medium ${nameClass}`}>{shownName}</span>}
        {!short && !narrow && meeting.locality && bottom - top >= 60 && <span className="shrink-0 truncate text-[0.6875rem] text-ink-muted">{meeting.locality}</span>}
      </span>
      <Details meeting={meeting} tint={tint} placement={placement} />
    </>
  );
  const className = `group absolute rounded-xl border border-l-[3px] ring-2 ring-surface border-(--tint-edge) bg-(--tint-bg) px-2 py-1 text-left hover:z-20! focus-visible:z-20! motion-safe:transition-shadow hover:shadow-card ${cancelled ? "border-dashed" : ""}`;
  return meeting.call_id ? (
    <Link href={`/dashboard/calls/${meeting.call_id}`} className={className} style={style}>
      {body}
    </Link>
  ) : (
    <div tabIndex={0} className={className} style={style}>
      {body}
    </div>
  );
}

type Column = { key: string; label: ReactNode; day: string; meetings: Meeting[]; today: boolean; emptyText: string };

function Grid({ columns, tints, now, minColRem }: { columns: Column[]; tints: (meeting: Meeting) => Tint; now: Date; minColRem: number }) {
  const total = DAY_END_MIN - DAY_START_MIN;
  const nowMin = istMinutes(now);
  const nowDay = istDate(now);
  const outside = columns.map((column) =>
    column.meetings.filter((meeting) => {
      const { start, end } = span(meeting);
      return end <= DAY_START_MIN || start >= DAY_END_MIN;
    }),
  );
  const template = { gridTemplateColumns: `3.25rem repeat(${columns.length}, minmax(${minColRem}rem, 1fr))`, minWidth: `${3.25 + columns.length * minColRem}rem` };
  const hourLines: CSSProperties = {
    height: `${GRID_REM}rem`,
    backgroundImage: `linear-gradient(to bottom, var(--line) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--line) 55%, transparent) 1px, transparent 1px)`,
    backgroundSize: `100% ${SLOT_REM * 2}rem, 100% ${SLOT_REM}rem`,
  };
  return (
    <div className="-mx-1 overflow-x-auto overscroll-x-contain px-1 pb-1" tabIndex={0} role="region" aria-label="Consultation calendar, scrolls sideways">
      <div className="grid" style={template}>
        <div aria-hidden="true" />
        {columns.map((column) => (
          <div key={column.key} className="border-b border-line px-2 pb-2.5">
            {column.label}
          </div>
        ))}
        {outside.some((list) => list.length > 0) && (
          <>
            <div className="pt-2 pr-2 text-right text-[0.625rem] leading-tight text-ink-soft">Off hours</div>
            {columns.map((column, i) => (
              <div key={column.key} className="flex flex-col gap-1 border-b border-line px-1 py-2">
                {outside[i].map((meeting) => (
                  <OffHours key={meeting.id} meeting={meeting} tint={tints(meeting)} />
                ))}
              </div>
            ))}
          </>
        )}
        <div className="relative py-3">
          <div className="relative" style={{ height: `${GRID_REM}rem` }}>
            {Array.from({ length: SLOTS / 2 + 1 }, (_, i) => (
              <span key={i} className="absolute right-2 -translate-y-1/2 text-[0.6875rem] tabular-nums text-ink-soft" style={{ top: `${((i * 60) / total) * 100}%` }}>
                {hhmm(DAY_START_MIN + i * 60)}
              </span>
            ))}
          </div>
        </div>
        {columns.map((column, ci) => {
          const inside = column.meetings.filter((meeting) => !outside[ci].includes(meeting));
          const placed = placeOverlaps(inside);
          const showNow = column.day === nowDay && nowMin >= DAY_START_MIN && nowMin <= DAY_END_MIN;
          const rightSide = columns.length > 2 && ci >= columns.length - 2;
          return (
            <div key={column.key} className={`relative border-l border-line py-3 ${column.today ? "bg-[color-mix(in_oklab,var(--accent-soft)_45%,transparent)]" : ""}`}>
              <div className="relative" style={hourLines}>
                {inside.length === 0 && (
                  <p className="absolute inset-x-2 top-6 rounded-xl border border-dashed border-line bg-surface/70 px-2 py-3 text-center text-xs text-ink-soft">{column.emptyText}</p>
                )}
                {placed.map(({ item, lane, lanes }) => {
                  const late = span(item).start >= 15 * 60;
                  const placement = `${late ? "bottom-full mb-1.5" : "top-full mt-1.5"} ${rightSide ? "right-0" : "left-0"}`;
                  return <Block key={item.id} meeting={item} tint={tints(item)} lane={lane} lanes={lanes} placement={placement} />;
                })}
                {showNow && (
                  <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: `${((nowMin - DAY_START_MIN) / total) * 100}%` }}>
                    <span className="-ml-1 h-2 w-2 shrink-0 -translate-y-px rounded-full bg-accent" />
                    <span className="h-0.5 flex-1 bg-accent" />
                    <span className="absolute -top-2.5 right-1 rounded-full bg-accent px-1.5 text-[0.625rem] font-medium leading-4 tabular-nums text-accent-ink">{hhmm(nowMin)}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OffHours({ meeting, tint }: { meeting: Meeting; tint: Tint }) {
  const cancelled = meeting.status === "cancelled";
  const content = (
    <>
      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: tint.swatch }} />
      <span className="tabular-nums text-ink-muted">{hhmm(span(meeting).start)}</span>
      <span className={`truncate ${cancelled ? "text-ink-soft line-through" : "text-ink"}`}>{meeting.caller_name ?? "Unknown caller"}</span>
    </>
  );
  const className = "flex min-w-0 items-center gap-1.5 rounded-lg bg-surface-2 px-2 py-1 text-[0.6875rem]";
  return meeting.call_id ? (
    <Link href={`/dashboard/calls/${meeting.call_id}`} className={`${className} hover:text-ink`}>
      {content}
    </Link>
  ) : (
    <span className={className}>{content}</span>
  );
}

function Upcoming({ meetings, tints, now, periodLabel }: { meetings: Meeting[]; tints: (meeting: Meeting) => Tint; now: Date; periodLabel: string }) {
  const next = meetings.filter((meeting) => meeting.status !== "cancelled" && meeting.end.getTime() > now.getTime()).slice(0, 8);
  return (
    <div className="mt-6 md:hidden">
      <h3 className="mb-3 text-sm font-medium text-ink">Upcoming</h3>
      {next.length === 0 ? (
        <p className="rounded-2xl bg-surface-2 px-4 py-5 text-center text-sm text-ink-soft">Nothing still to come {periodLabel}.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {next.map((meeting) => {
            const tint = tints(meeting);
            const row = (
              <span className="flex items-start gap-3 rounded-2xl border border-line border-l-[3px] px-3.5 py-3" style={{ borderLeftColor: tint.edge, background: tint.bg }}>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2 text-xs text-ink-muted">
                    <span className="tabular-nums">
                      {dayLabel(meeting.day, { weekday: "short", day: "numeric", month: "short" })} · {timeRange(meeting)}
                    </span>
                    <StatusTag status={meeting.status} />
                  </span>
                  <span className="truncate text-sm font-medium text-ink">{meeting.caller_name ?? "Unknown caller"}</span>
                  <span className="flex items-center gap-1.5 truncate text-xs text-ink-muted">
                    <TypeIcon type={meeting.consult_type} />
                    {TYPE_LABEL[meeting.consult_type]}
                    {meeting.locality ? ` · ${meeting.locality}` : ""} · {meeting.designer_name ?? "Unassigned"}
                  </span>
                </span>
              </span>
            );
            return (
              <li key={meeting.id}>
                {meeting.call_id ? (
                  <Link href={`/dashboard/calls/${meeting.call_id}`} className="block rounded-2xl">
                    {row}
                  </Link>
                ) : (
                  row
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function ConsultationCalendar({
  params,
  cal,
  meetings,
  designers,
  now,
}: {
  params: CalendarParams;
  cal: CalendarView;
  meetings: Meeting[];
  designers: DesignerRef[];
  now: Date;
}) {
  // Every designer gets a stable tint from their position in the name-sorted list.
  const known = new Map(designers.map((d) => [d.id, d.name]));
  for (const meeting of meetings) if (meeting.designer_id && !known.has(meeting.designer_id)) known.set(meeting.designer_id, meeting.designer_name ?? "Designer");
  const ordered = [...known.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  const tintIndex = new Map(ordered.map((d, i) => [d.id, i]));
  const tints = (meeting: Meeting) => (meeting.designer_id && tintIndex.has(meeting.designer_id) ? tintFor(tintIndex.get(meeting.designer_id)!) : UNASSIGNED_TINT);
  const hasUnassigned = meetings.some((meeting) => !meeting.designer_id);
  const active = meetings.filter((meeting) => meeting.status !== "cancelled");

  const isWeek = cal.view === "week";
  const step = isWeek ? 7 : 1;
  const navKey = isWeek ? "week" : "date";
  const title = isWeek
    ? `${dayLabel(cal.days[0], { day: "numeric", month: "short" })} – ${dayLabel(cal.days[6], { day: "numeric", month: "short", year: "numeric" })}`
    : dayLabel(cal.start, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const containsToday = cal.today >= cal.start && cal.today < cal.end;

  let columns: Column[];
  if (isWeek) {
    columns = cal.days.map((day) => {
      const list = meetings.filter((meeting) => meeting.day === day);
      const count = list.filter((meeting) => meeting.status !== "cancelled").length;
      const today = day === cal.today;
      return {
        key: day,
        day,
        today,
        meetings: list,
        emptyText: "No consultations",
        label: (
          <Link href={href(params, { view: "day", date: day, week: undefined })} className="group flex flex-col items-start gap-0.5 rounded-xl">
            <span className="text-[0.6875rem] uppercase tracking-wider text-ink-soft">{dayLabel(day, { weekday: "short" })}</span>
            <span className="flex items-baseline gap-2">
              <span className={`grid h-8 min-w-8 place-items-center rounded-full px-1 text-lg font-light tabular-nums ${today ? "bg-accent text-accent-ink" : "text-ink group-hover:bg-surface-2"}`}>
                {Number(day.slice(8))}
              </span>
              <span className="text-[0.6875rem] text-ink-soft">{count === 0 ? "free" : `${count} booked`}</span>
            </span>
          </Link>
        ),
      };
    });
  } else {
    const shown = cal.designer ? ordered.filter((d) => d.id === cal.designer) : ordered;
    columns = shown.map((d) => {
      const list = meetings.filter((meeting) => meeting.designer_id === d.id);
      const tint = tintFor(tintIndex.get(d.id) ?? 0);
      return {
        key: d.id,
        day: cal.start,
        today: false,
        meetings: list,
        emptyText: "Free all day",
        label: (
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: tint.swatch }} />
            <span className="truncate text-sm font-medium text-ink">{d.name}</span>
            <span className="shrink-0 text-[0.6875rem] text-ink-soft">{list.filter((m) => m.status !== "cancelled").length}</span>
          </span>
        ),
      };
    });
    if (!cal.designer && hasUnassigned)
      columns.push({
        key: "unassigned",
        day: cal.start,
        today: false,
        meetings: meetings.filter((meeting) => !meeting.designer_id),
        emptyText: "No consultations",
        label: <span className="text-sm font-medium text-ink-muted">Unassigned</span>,
      });
  }

  const periodLabel = isWeek ? "this week" : "on this day";
  const designerName = cal.designer ? (known.get(cal.designer) ?? "this designer") : null;

  return (
    <section id="schedule" aria-labelledby="schedule-title" className="min-w-0 scroll-mt-6 rounded-3xl border border-line bg-surface p-5 shadow-card sm:p-7">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id="schedule-title" className="text-base font-medium tracking-tight text-ink">
            Scheduled consultations
          </h2>
          <p className="text-sm text-ink-soft">
            {title}
            <span className="sr-only"> ({cal.view} view)</span>
            {" · "}
            {active.length === 0 ? "none booked" : `${active.length} booked`}
            {designerName ? ` for ${designerName}` : ""}
          </p>
        </div>
        <nav aria-label="Calendar navigation" className="flex flex-wrap items-center gap-2">
          <span className="inline-flex rounded-full border border-line bg-surface-2 p-0.5">
            <Link
              href={href(params, { view: "day", date: containsToday ? cal.today : cal.start, week: undefined })}
              aria-current={!isWeek ? "page" : undefined}
              className={`rounded-full px-3.5 py-1 text-sm transition ${!isWeek ? "bg-surface text-ink shadow-card" : "text-ink-muted hover:text-ink"}`}
            >
              Day
            </Link>
            <Link
              href={href(params, { view: undefined, week: mondayOf(cal.start), date: undefined })}
              aria-current={isWeek ? "page" : undefined}
              className={`rounded-full px-3.5 py-1 text-sm transition ${isWeek ? "bg-surface text-ink shadow-card" : "text-ink-muted hover:text-ink"}`}
            >
              Week
            </Link>
          </span>
          <Link href={href(params, { [navKey]: addDays(cal.start, -step) })} className={`${pillIdle} px-2.5`} aria-label={isWeek ? "Previous week" : "Previous day"}>
            <span aria-hidden="true">←</span>
          </Link>
          <Link href={href(params, { week: undefined, date: undefined })} className={containsToday ? pillActive : pillIdle} aria-current={containsToday ? "date" : undefined}>
            Today
          </Link>
          <Link href={href(params, { [navKey]: addDays(cal.start, step) })} className={`${pillIdle} px-2.5`} aria-label={isWeek ? "Next week" : "Next day"}>
            <span aria-hidden="true">→</span>
          </Link>
        </nav>
      </div>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <nav aria-label="Filter by designer" className="-mx-1 flex max-w-full gap-2 overflow-x-auto px-1 pb-1">
          <Link href={href(params, { designer: undefined })} aria-current={!cal.designer ? "true" : undefined} className={!cal.designer ? pillActive : pillIdle}>
            All designers
          </Link>
          {ordered.map((d) => {
            const selected = cal.designer === d.id;
            return (
              <Link key={d.id} href={href(params, { designer: selected ? undefined : d.id })} aria-current={selected ? "true" : undefined} className={`${selected ? pillActive : pillIdle} gap-2`}>
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full ring-1 ring-surface" style={{ background: tintFor(tintIndex.get(d.id)!).swatch }} />
                {d.name}
              </Link>
            );
          })}
          {hasUnassigned && !cal.designer && (
            <span className={`${pill} gap-2 text-ink-soft`}>
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: UNASSIGNED_TINT.swatch }} />
              Unassigned
            </span>
          )}
        </nav>
        <ul aria-label="Key" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-muted">
          {(Object.keys(TYPE_LABEL) as ConsultType[]).map((type) => (
            <li key={type} className="flex items-center gap-1.5">
              <TypeIcon type={type} />
              {TYPE_LABEL[type]}
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <RescheduledIcon />
            Rescheduled
          </li>
          <li className="text-ink-soft line-through">Cancelled</li>
        </ul>
      </div>

      {meetings.length === 0 || columns.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-surface-2 px-6 py-12 text-center">
          <span aria-hidden="true" className="grid h-11 w-11 place-items-center rounded-full bg-accent-soft text-accent-soft-ink">
            <svg viewBox="0 0 16 16" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <rect x="2.5" y="3.5" width="11" height="10" rx="2" />
              <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
            </svg>
          </span>
          <p className="text-sm font-medium text-ink">No consultations {periodLabel}{designerName ? ` for ${designerName}` : ""}.</p>
          <p className="max-w-sm text-sm text-ink-soft">Bookings made by the front desk appear here as soon as Cal.com confirms them.</p>
          {!containsToday && (
            <Link href={href(params, { week: undefined, date: undefined })} className={pillIdle}>
              Go to today
            </Link>
          )}
        </div>
      ) : (
        <Grid columns={columns} tints={tints} now={now} minColRem={isWeek ? 8.75 : 12} />
      )}

      <Upcoming meetings={meetings} tints={tints} now={now} periodLabel={periodLabel} />
      <p className="mt-4 hidden text-xs text-ink-soft md:block">Times are IST. Hover or focus a meeting for its scope and contact; select it to open the enquiry call.</p>
    </section>
  );
}
