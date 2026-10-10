// Turns what the caller says about their availability into time windows, and picks a few
// slots spread across days. Pure functions; times are interpreted in IST.
import { DAY_KEYS, type DayKey, istParts } from "../rules/time";

export type SlotWindow = { days: DayKey[]; from: number; to: number }; // minutes since midnight, IST
export type SlotConstraints = { windows: SlotWindow[]; notBefore?: string }; // ISO date, IST

const WEEKDAYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri"];
const WEEKEND: DayKey[] = ["sat", "sun"];
const ALL_DAYS: DayKey[] = [...DAY_KEYS];
const DAY_WORDS: Record<string, DayKey> = {
  monday: "mon", tuesday: "tue", wednesday: "wed", thursday: "thu", friday: "fri", saturday: "sat", sunday: "sun",
  mon: "mon", tue: "tue", tues: "tue", wed: "wed", thu: "thu", thurs: "thu", fri: "fri", sat: "sat", sun: "sun",
};
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function clockMinutes(hour: number, minute: number, meridiem?: string): number {
  let h = hour % 12;
  if (meridiem?.startsWith("p")) h += 12;
  if (!meridiem && hour < 8) h += 12; // "after 6" on a call means 6 pm
  if (!meridiem && hour >= 12) h = hour;
  return h * 60 + minute;
}

function timeRange(part: string): { from: number; to: number } | undefined {
  const after = part.match(/\b(?:after|from|post)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/);
  const before = part.match(/\b(?:before|until|till|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/);
  if (after || before) {
    return {
      from: after ? clockMinutes(Number(after[1]), Number(after[2] ?? 0), after[3]) : 0,
      to: before ? clockMinutes(Number(before[1]), Number(before[2] ?? 0), before[3]) : 24 * 60,
    };
  }
  if (/\bmorning\b/.test(part)) return { from: 0, to: 12 * 60 };
  if (/\bafternoon\b/.test(part)) return { from: 12 * 60, to: 17 * 60 };
  if (/\b(evening|after work|after office)\b/.test(part)) return { from: 17 * 60, to: 24 * 60 };
  return undefined;
}

function daysIn(part: string): DayKey[] | undefined {
  if (/\bweekends?\b/.test(part)) return WEEKEND;
  if (/\bweekdays?\b/.test(part)) return WEEKDAYS;
  const named = [...new Set((part.match(/\b[a-z]+\b/g) ?? []).map((word) => DAY_WORDS[word]).filter(Boolean))];
  return named.length > 0 ? named : undefined;
}

// "weekdays after 6pm or weekends only" -> two windows. Unrecognised text -> no constraint.
export function parseSlotConstraints(text: string | undefined, now: Date): SlotConstraints {
  if (!text?.trim()) return { windows: [] };
  const lower = text.toLowerCase();
  const windows: SlotWindow[] = [];
  for (const part of lower.split(/\bor\b|;|,(?=\s*(?:or|weekends?|weekdays?|mon|tue|wed|thu|fri|sat|sun))/)) {
    const days = daysIn(part);
    const range = timeRange(part);
    if (days || range) windows.push({ days: days ?? ALL_DAYS, from: range?.from ?? 0, to: range?.to ?? 24 * 60 });
  }
  let notBefore: string | undefined;
  const after = lower.match(/\b(?:not before|after|from)\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:\s+(?:of\s+)?([a-z]{3})[a-z]*)?\b(?!\s*(?::|am|pm|a\.m|p\.m))/);
  if (after && (after[2] || /\b(?:st|nd|rd|th)\b|the\s+\d/.test(after[0]))) {
    const p = istParts(now);
    const day = Number(after[1]);
    let month = after[2] ? MONTHS.indexOf(after[2]) + 1 : p.month;
    let year = p.year;
    if (!after[2] && day < p.day) month += 1;
    if (month > 12) {
      month -= 12;
      year += 1;
    } else if (after[2] && month < p.month) year += 1;
    if (month >= 1 && day >= 1 && day <= 31) notBefore = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return { windows, notBefore };
}

export function slotAllowed(startIso: string, constraints: SlotConstraints): boolean {
  const p = istParts(new Date(startIso));
  const isoDay = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  if (constraints.notBefore && isoDay < constraints.notBefore) return false;
  if (constraints.windows.length === 0) return true;
  const minute = p.hour * 60 + p.minute;
  return constraints.windows.some((window) => window.days.includes(p.weekday) && minute >= window.from && minute < window.to);
}

// First allowed slot, then the first allowed slot on each later day, up to `count`.
export function pickSlots(startsIso: string[], constraints: SlotConstraints, count = 3): string[] {
  const allowed = startsIso.filter((start) => slotAllowed(start, constraints));
  const picked: string[] = [];
  const days = new Set<string>();
  for (const start of allowed) {
    const p = istParts(new Date(start));
    const key = `${p.year}-${p.month}-${p.day}`;
    if (days.has(key)) continue;
    days.add(key);
    picked.push(start);
    if (picked.length === count) break;
  }
  return picked;
}

const DAY_NAMES: Record<DayKey, string> = {
  sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday",
};
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// "Tuesday 14 October at 4 pm" / "... at 4:30 pm"
export function spokenSlot(startIso: string): string {
  const p = istParts(new Date(startIso));
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const time = p.minute === 0 ? `${hour12}` : `${hour12}:${String(p.minute).padStart(2, "0")}`;
  return `${DAY_NAMES[p.weekday]} ${p.day} ${MONTH_NAMES[p.month - 1]} at ${time} ${p.hour < 12 ? "am" : "pm"}`;
}
