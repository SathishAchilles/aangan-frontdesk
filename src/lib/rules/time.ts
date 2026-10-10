// India has no daylight saving, so IST is a fixed UTC+05:30 offset.
export const IST_OFFSET_MIN = 330;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export type IstParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: DayKey };

export function istParts(date: Date): IstParts {
  const shifted = new Date(date.getTime() + IST_OFFSET_MIN * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: DAY_KEYS[shifted.getUTCDay()],
  };
}

// The instant at which it is the given wall-clock time in IST.
export function fromIst(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - IST_OFFSET_MIN * 60_000);
}

export function endOfMonthIst(year: number, month: number): Date {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return fromIst(year, month, lastDay, 23, 59);
}

export function weeksBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / WEEK_MS;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function addWeeks(date: Date, weeks: number): Date {
  return new Date(date.getTime() + weeks * WEEK_MS);
}

export function addMonthsIst(date: Date, months: number): Date {
  const p = istParts(date);
  const totalMonths = p.year * 12 + (p.month - 1) + months;
  const year = Math.floor(totalMonths / 12);
  const month = (totalMonths % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return fromIst(year, month, Math.min(p.day, lastDay), p.hour, p.minute);
}

export function isoDateIst(date: Date): string {
  const p = istParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
