// Office-hours arithmetic in IST. Shared by the voice tools (is the office open? when do we call
// back?) and the follow-ups job (reminder and escalation clocks only count office minutes).
import { DAY_KEYS, type DayKey, fromIst, istParts } from "./time";

export type OfficeConfig = {
  start: string; // "10:00"
  end: string; // "19:00"
  days: DayKey[];
  holidays?: string[]; // ISO dates, IST
};

function minutesOf(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

function isoDay(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isWorkingDay(date: Date, config: OfficeConfig): boolean {
  const p = istParts(date);
  return config.days.includes(p.weekday) && !(config.holidays ?? []).includes(isoDay(p.year, p.month, p.day));
}

export function isOfficeOpen(now: Date, config: OfficeConfig): boolean {
  if (!isWorkingDay(now, config)) return false;
  const p = istParts(now);
  const minute = p.hour * 60 + p.minute;
  return minute >= minutesOf(config.start) && minute < minutesOf(config.end);
}

function officeOpenOn(date: Date, config: OfficeConfig): Date {
  const p = istParts(date);
  const start = minutesOf(config.start);
  return fromIst(p.year, p.month, p.day, Math.floor(start / 60), start % 60);
}

function officeCloseOn(date: Date, config: OfficeConfig): Date {
  const p = istParts(date);
  const end = minutesOf(config.end);
  return fromIst(p.year, p.month, p.day, Math.floor(end / 60), end % 60);
}

// The next moment the office is open: `now` itself if it is open.
export function nextOfficeOpen(now: Date, config: OfficeConfig): Date {
  if (isOfficeOpen(now, config)) return now;
  let day = now;
  for (let i = 0; i < 31; i += 1) {
    if (isWorkingDay(day, config)) {
      const open = officeOpenOn(day, config);
      if (open.getTime() > now.getTime()) return open;
    }
    const p = istParts(day);
    day = fromIst(p.year, p.month, p.day + 1, 12, 0);
  }
  throw new Error("No office day in the next 31 days; check office_days and holidays");
}

// The instant `minutes` of office time after `start` (time outside office hours does not count).
export function addOfficeMinutes(start: Date, minutes: number, config: OfficeConfig): Date {
  let cursor = nextOfficeOpen(start, config);
  let remaining = minutes;
  for (let guard = 0; guard < 400; guard += 1) {
    const close = officeCloseOn(cursor, config);
    const available = (close.getTime() - cursor.getTime()) / 60_000;
    if (remaining <= available) return new Date(cursor.getTime() + remaining * 60_000);
    remaining -= available;
    cursor = nextOfficeOpen(close, config);
  }
  throw new Error("addOfficeMinutes did not converge");
}

// Office minutes elapsed between two instants.
export function officeMinutesBetween(from: Date, to: Date, config: OfficeConfig): number {
  if (to.getTime() <= from.getTime()) return 0;
  let cursor = nextOfficeOpen(from, config);
  let total = 0;
  for (let guard = 0; guard < 400 && cursor.getTime() < to.getTime(); guard += 1) {
    const close = officeCloseOn(cursor, config);
    const end = Math.min(close.getTime(), to.getTime());
    total += (end - cursor.getTime()) / 60_000;
    cursor = nextOfficeOpen(close, config);
  }
  return Math.round(total);
}

// Spoken form of a callback promise, for example "by 10:30 tomorrow morning" or "within 30 minutes".
export function describeCallback(now: Date, config: OfficeConfig, withinMin: number, afterHoursTime: string): { at: Date; words: string } {
  if (isOfficeOpen(now, config)) {
    return { at: addOfficeMinutes(now, withinMin, config), words: `within ${withinMin} minutes` };
  }
  const open = nextOfficeOpen(now, config);
  const p = istParts(open);
  const target = minutesOf(afterHoursTime);
  const at = fromIst(p.year, p.month, p.day, Math.floor(target / 60), target % 60);
  const today = istParts(now);
  const tomorrow = istParts(fromIst(today.year, today.month, today.day + 1, 12));
  const dayWords =
    p.day === today.day && p.month === today.month
      ? "this morning"
      : p.day === tomorrow.day && p.month === tomorrow.month
        ? "tomorrow morning"
        : `on ${dayName(p.weekday)} morning`;
  return { at, words: `by ${afterHoursTime} ${dayWords}` };
}

function dayName(day: DayKey): string {
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return names[DAY_KEYS.indexOf(day)];
}
