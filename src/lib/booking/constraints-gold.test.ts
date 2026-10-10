// Compares the constraint parser with the gold windows in evals/datasets/slot-constraints.jsonl,
// minute by minute (every 30 minutes) across a whole week.
import { describe, expect, it } from "vitest";
import { loadJsonl } from "../../evals/datasets";
import { slotConstraintSchema } from "../../evals/types";
import { fromIst, istParts } from "../rules/time";
import { parseSlotConstraints, slotAllowed } from "./slots";

const NOW = fromIst(2026, 10, 11, 12, 0); // Sunday
const gold = loadJsonl("slot-constraints.jsonl", slotConstraintSchema);
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

function goldAllows(item: (typeof gold)[number], date: Date): boolean {
  const p = istParts(date);
  const minute = p.hour * 60 + p.minute;
  return item.allowed.some((window) => window.days.includes(p.weekday) && minute >= toMinutes(window.from) && minute < Math.max(toMinutes(window.to), window.to === "23:59" ? 24 * 60 : 0));
}

describe("slot constraints match gold", () => {
  it("has 30 labelled phrases", () => expect(gold).toHaveLength(30));

  it.each(gold.map((item) => [item.id, item.phrase, item] as const))("%s %s", (_id, _phrase, item) => {
    const constraints = parseSlotConstraints(item.phrase, NOW);
    const mismatches: string[] = [];
    for (let day = 12; day <= 18; day += 1) {
      for (let half = 0; half < 48; half += 1) {
        const at = fromIst(2026, 10, day, Math.floor(half / 2), (half % 2) * 30);
        if (slotAllowed(at.toISOString(), constraints) !== goldAllows(item, at)) mismatches.push(at.toISOString());
      }
    }
    expect(mismatches.slice(0, 3)).toEqual([]);
  });
});
