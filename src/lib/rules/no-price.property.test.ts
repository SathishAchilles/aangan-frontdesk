// Property: whatever the caller says about money, size or scope, nothing the gate returns
// (spoken lines, questions, reasons, flags) contains a cost figure.
import { describe, expect, it } from "vitest";
import { containsPriceFigure } from "../../evals/graders/deterministic";
import { defaultRulesConfig } from "./config";
import type { Facts } from "./facts";
import { evaluateEnquiry } from "./gate";
import { fromIst } from "./time";

// Small deterministic generator so failures are reproducible.
function generator(seed: number) {
  let state = seed;
  const next = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
  const pick = <T,>(values: readonly T[]): T => values[Math.floor(next() * values.length)];
  return { next, pick };
}

const BUDGETS = ["1 lakh", "₹2-3 lakh", "50 lakh", "1.5 crore", "Rs 800000", "reasonable", "", "80k", "4–5 lakh max"];
const LOCALITIES = ["Kothrud", "Nashik", "somewhere", "", "Pimple Saudagar", "Talegaon", "Baner, Pune"];
const DEADLINES = ["in 2 weeks", "by March", "no rush", "before Diwali", "", "asap", "January start", "in 9 weeks"];
const SCOPES = ["kitchen", "full home redesign", "just ideas", "restaurant interiors", "office fitout", "", "two bedrooms"];

describe("gate outputs never contain a price figure", () => {
  it("holds for 500 generated callers", () => {
    const config = defaultRulesConfig();
    const { next, pick } = generator(42);
    for (let i = 0; i < 500; i += 1) {
      const facts: Facts = {
        intent: pick(["new", "new", "new", "existing", "other"] as const),
        project_type: pick(["residential", "commercial", "unknown"] as const),
        scope_text: pick(SCOPES),
        rooms: next() > 0.5 ? ["kitchen", "bedroom"] : undefined,
        full_home: next() > 0.5,
        sqft: next() > 0.3 ? Math.round(100 + next() * 6000) : undefined,
        locality: pick(LOCALITIES),
        deadline_text: pick(DEADLINES),
        budget_text: pick(BUDGETS),
        decision_text: pick(["I'm the owner", "for my parents", ""]),
        wants_human: next() > 0.9,
      };
      const asked = pick([[], ["C1"], ["C1", "C2", "C3"]] as const);
      const result = evaluateEnquiry({ facts, asked: [...asked], now: fromIst(2026, 9, 10, next() > 0.5 ? 11 : 22), config });
      const outputs = [
        result.say_line ?? "",
        result.next_question ?? "",
        ...result.flags,
        ...result.fail_reasons,
        ...result.criteria.map((criterion) => criterion.reason),
      ];
      for (const text of outputs) expect(containsPriceFigure(text), `caller ${i}: ${text}`).toBe(false);
    }
  });
});
