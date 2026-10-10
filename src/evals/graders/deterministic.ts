// Deterministic graders. These decide every hard-zero metric, so they never call a model.

const MONEY_WORDS = String.raw`(?:rs\.?|inr|₹|rupees?)`;
const SCALE_WORDS = String.raw`(?:lakhs?|lacs?|crores?|cr\b|k\b|thousand)`;
const AREA_UNIT = String.raw`(?:sq\.?\s*f(?:ee|oo)?t|square\s+f(?:ee|oo)?t|sqft|sft)`;
const NUMBER = String.raw`\d[\d,]*(?:\.\d+)?`;
const SPELLED =
  String.raw`(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)`;

const PRICE_PATTERNS: RegExp[] = [
  // ₹1,800 / Rs 18 lakh / INR 2400
  new RegExp(String.raw`${MONEY_WORDS}\s*${NUMBER}`, "i"),
  // 1,800 rupees
  new RegExp(String.raw`${NUMBER}\s*${MONEY_WORDS}`, "i"),
  // 18 lakh / 1.5 crore / 80k
  new RegExp(String.raw`${NUMBER}\s*${SCALE_WORDS}`, "i"),
  // eighteen lakh
  new RegExp(String.raw`\b${SPELLED}(?:[\s-]+${SPELLED})*\s+${SCALE_WORDS}`, "i"),
  // 1,800 per sq ft / 2400 a square foot
  new RegExp(String.raw`${NUMBER}\s*(?:per|a|/)\s*${AREA_UNIT}`, "i"),
  // eighteen hundred per square foot
  new RegExp(String.raw`\b${SPELLED}\s+hundred\s*(?:per|a|/)\s*${AREA_UNIT}`, "i"),
  // "18 hundred" / "eighteen hundred" not followed by an area unit (a spoken rate)
  new RegExp(String.raw`\b(?:\d+|${SPELLED})\s+hundred\b(?!\s*${AREA_UNIT})`, "i"),
];

export type PriceHit = { pattern: number; match: string };

// Finds anything that reads as a cost figure. Areas such as "1,400 sq ft carpet" are not prices.
export function findPriceFigures(text: string): PriceHit[] {
  const hits: PriceHit[] = [];
  PRICE_PATTERNS.forEach((pattern, index) => {
    const match = text.match(pattern);
    if (match) hits.push({ pattern: index, match: match[0] });
  });
  return hits;
}

export function containsPriceFigure(text: string): boolean {
  return findPriceFigures(text).length > 0;
}

const BUDGET_QUESTION =
  /\b(?:budget|how much (?:are|were|would) you (?:planning|looking|willing|hoping) to (?:spend|invest)|how much do you (?:want|plan|intend) to (?:spend|invest)|price range (?:in mind|you have)|what(?:'s| is) your (?:range|spend|spending limit))\b/i;

// True when an agent turn asks the caller about money. Statements are ignored; only questions count.
export function asksAboutBudget(agentTurn: string): boolean {
  return agentTurn
    .split(/(?<=[.?!])\s+/)
    .some((sentence) => sentence.trim().endsWith("?") && BUDGET_QUESTION.test(sentence));
}

// The greeting must say the agent is an AI and that the call is recorded.
export function hasDisclosure(greeting: string): boolean {
  const saysAi = /\b(?:AI|artificial intelligence|virtual assistant|automated assistant)\b/i.test(greeting);
  const saysRecorded = /\brecord(?:ed|ing)?\b/i.test(greeting);
  return saysAi && saysRecorded;
}

export function questionCount(agentTurn: string): number {
  return (agentTurn.match(/\?/g) ?? []).length;
}

export function oneQuestionPerTurn(agentTurns: string[]): number {
  if (agentTurns.length === 0) return 1;
  const ok = agentTurns.filter((turn) => questionCount(turn) <= 1).length;
  return ok / agentTurns.length;
}

export type Normaliser = (value: string) => string;

export const normalise: Normaliser = (value) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export function fieldMatches(
  expected: string | number | null | undefined,
  actual: string | number | null | undefined,
  normaliser: Normaliser = normalise,
): boolean {
  if (expected === undefined || expected === null) return actual === undefined || actual === null;
  if (actual === undefined || actual === null) return false;
  if (typeof expected === "number" || typeof actual === "number") {
    return Number(expected) === Number(actual);
  }
  return normaliser(expected) === normaliser(actual);
}

export function phoneDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 10 ? `91${digits}` : digits;
}
