// Turns the caller's words into numbers, dates and places. Pure functions; "now" is always passed in.
import { addMonthsIst, addWeeks, endOfMonthIst, fromIst, istParts } from "./time";

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, a: 1, an: 1, couple: 2, few: 3,
};

function toNumber(token: string): number | undefined {
  const cleaned = token.toLowerCase().replace(/,/g, "");
  if (/^\d+(\.\d+)?$/.test(cleaned)) return Number(cleaned);
  return WORD_NUMBERS[cleaned];
}

const NUM = String.raw`(\d[\d,]*(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|a|an|couple|few)`;

// "about 1,400 sq ft carpet", "5,500 sq ft", "800 square feet", "~920 sq ft"
export function parseSqft(text: string | number | undefined): number | undefined {
  if (typeof text === "number") return text > 0 ? text : undefined;
  if (!text) return undefined;
  const match = text.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:sq\.?\s*f(?:ee|oo)?t|square\s+f(?:ee|oo)?t|sqft|sft)/i);
  return match ? Number(match[1].replace(/,/g, "")) : undefined;
}

export type MoneyRange = { min: number; max: number };

const SCALE: Record<string, number> = { lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, l: 1e5, crore: 1e7, crores: 1e7, cr: 1e7, k: 1e3, thousand: 1e3 };

// "1 to 1.5 lakh maximum", "₹15–20 lakh", "Rs 60-80 lakh all-in", "4-5 lakh", "1.2 crore", "500000"
export function parseMoneyInr(text: string | undefined): MoneyRange | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase().replace(/rs\.?|inr|₹|rupees?/g, " ");
  const range = t.match(
    /(\d[\d,]*(?:\.\d+)?)\s*(lakhs?|lacs?|crores?|cr|k|thousand)?\s*(?:-|–|—|to)\s*(\d[\d,]*(?:\.\d+)?)\s*(lakhs?|lacs?|crores?|cr|l|k|thousand)\b/,
  );
  if (range) {
    const highScale = SCALE[range[4]];
    const lowScale = range[2] ? SCALE[range[2]] : highScale;
    return { min: Number(range[1].replace(/,/g, "")) * lowScale, max: Number(range[3].replace(/,/g, "")) * highScale };
  }
  const single = t.match(/(\d[\d,]*(?:\.\d+)?)\s*(lakhs?|lacs?|crores?|cr|k|thousand)\b/);
  if (single) {
    const value = Number(single[1].replace(/,/g, "")) * SCALE[single[2]];
    return { min: value, max: value };
  }
  const plain = t.match(/\b(\d{5,}|\d{1,3}(?:,\d{2,3})+)\b/);
  if (plain) {
    const value = Number(plain[1].replace(/,/g, ""));
    return { min: value, max: value };
  }
  return undefined;
}

export type DeadlineKind = "complete" | "start" | "flexible" | "asap" | "unknown";
export type Deadline = { kind: DeadlineKind; date?: Date; matched?: string };
export type Festival = { name: string; date: string };

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;

function monthIndex(token: string): number {
  return MONTHS.findIndex((month) => month.startsWith(token.toLowerCase().slice(0, 3)));
}

// The end of the next occurrence of a month (this month counts), or of the given year.
function resolveMonth(token: string, yearToken: string | undefined, now: Date): Date {
  const month = monthIndex(token) + 1;
  const p = istParts(now);
  const year = yearToken ? Number(yearToken) : month >= p.month ? p.year : p.year + 1;
  return endOfMonthIst(year, month);
}

const START_WORDS = /\b(start|starting|begin|beginning|commence|kick off)\b/;

// Reads when the caller needs the project done (or wants to start), relative to `now`.
export function parseDeadline(text: string | undefined, now: Date, festivals: Festival[] = []): Deadline {
  if (!text || !text.trim()) return { kind: "unknown" };
  const t = text.toLowerCase();
  const isStart = START_WORDS.test(t) && !/\b(done|complete|ready|move (?:back )?in|operational)\b/.test(t);

  // Explicit durations win over named dates ("before Diwali, about three weeks away").
  const duration = t.match(new RegExp(String.raw`${NUM}\s+(weeks?|months?)`));
  if (duration) {
    const amount = toNumber(duration[1]);
    if (amount !== undefined) {
      const date = duration[2].startsWith("week") ? addWeeks(now, amount) : addMonthsIst(now, amount);
      return { kind: isStart ? "start" : "complete", date, matched: duration[0] };
    }
  }

  // Each month mention is a start or a completion depending on the words around it;
  // a completion date wins because that is what the timeline rule measures.
  const monthMentions = [...t.matchAll(new RegExp(String.raw`\b${MONTH_RE}\b(?:\s+(20\d{2}))?`, "g"))].map((match) => {
    const before = t.slice(Math.max(0, (match.index ?? 0) - 40), match.index);
    const after = t.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 25);
    const startHere = /\b(start|starting|begin|beginning|commence)\b[\w\s,]*$/.test(before) || /^\s*(start|for execution)/.test(after);
    const completeHere = /\b(done|complete|ready|finish(?:ed)?|move (?:back )?in|moving in|operational|by|before)\b[\w\s,]*$/.test(before);
    const kind: DeadlineKind = startHere && !completeHere ? "start" : "complete";
    return { kind, date: resolveMonth(match[1], match[2], now), matched: match[0] };
  });
  if (monthMentions.length > 0) {
    const completion = monthMentions.find((mention) => mention.kind === "complete");
    return completion ?? monthMentions[0];
  }

  for (const festival of festivals) {
    if (t.includes(festival.name.toLowerCase())) {
      const [year, month, day] = festival.date.split("-").map(Number);
      const date = fromIst(year, month, day);
      if (date.getTime() >= now.getTime()) return { kind: isStart ? "start" : "complete", date, matched: festival.name };
    }
  }

  if (/\b(immediately|right away|right now|this month)\b/.test(t) && START_WORDS.test(t)) {
    return { kind: "start", date: now, matched: "start now" };
  }
  if (/\b(asap|as soon as possible|urgent(?:ly)?)\b/.test(t)) {
    return isStart ? { kind: "start", date: now, matched: "start now" } : { kind: "asap", matched: "asap" };
  }
  if (/\b(no (?:specific )?(?:deadline|rush|hurry)|flexible|whenever|plenty of time|not in a rush|no fixed date)\b/.test(t)) {
    return { kind: "flexible", matched: "flexible" };
  }
  return { kind: "unknown" };
}

export type Locality = { name: string; aliases: string[]; status: "in" | "out" };
export type LocalityMatch = { name: string; status: "in" | "out" } | undefined;

function normaliseText(value: string): string {
  return ` ${value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

// Finds the most specific known place mentioned in the caller's words.
export function matchLocality(text: string | undefined, localities: Locality[]): LocalityMatch {
  if (!text) return undefined;
  const haystack = normaliseText(text);
  let best: { name: string; status: "in" | "out"; length: number } | undefined;
  for (const locality of localities) {
    for (const candidate of [locality.name, ...locality.aliases]) {
      const needle = normaliseText(candidate);
      if (needle.trim() && haystack.includes(needle) && (!best || needle.length > best.length)) {
        best = { name: locality.name, status: locality.status, length: needle.length };
      }
    }
  }
  return best ? { name: best.name, status: best.status } : undefined;
}
