import { describe, expect, it } from "vitest";
import { withAs } from "./links";
import { noteView } from "./note";
import { bucketsFor, delta, median, performance } from "./performance";
import { REDACTED, redactPrices, withoutPrice } from "./redact";

describe("price redaction", () => {
  it("drops short text that names a figure", () => {
    expect(withoutPrice("3BHK in Baner, full home")).toBe("3BHK in Baner, full home");
    expect(withoutPrice("Wants it done for about 12 lakh")).toBeNull();
    expect(withoutPrice("₹1,800 per sq ft quoted elsewhere")).toBeNull();
    expect(withoutPrice(42)).toBeNull();
  });
  it("keeps areas, which are not prices", () => expect(withoutPrice("1,400 sq ft carpet")).toBe("1,400 sq ft carpet"));
  it("replaces only the sentences with a figure in a transcript", () => {
    const out = redactPrices("Agent: Which area is the flat in?\nCaller: Baner. My budget is around 15 lakhs. We move in March.");
    expect(out).toBe(`Agent: Which area is the flat in?\nCaller: Baner. ${REDACTED} We move in March.`);
    expect(out).not.toMatch(/15|lakh/);
  });
});

describe("noteView", () => {
  const note = {
    client_name: "Priya",
    area: "Baner",
    property: "3BHK apartment",
    size_sqft: 1400,
    scope: "Full home interiors",
    timeline: "Within 2 months",
    decision_maker: "Both spouses",
    budget_mentioned: "18 lakh",
    style_or_preferences: "Warm wood, minimal",
    watch_outs: ["Tight timeline", "Said another studio quoted 20 lakh"],
    one_line_summary: "Young couple, full 3BHK fit-out in Baner",
    criteria: { C1: "pass", C2: "pass", C3: "unclear", C4: "pass", C5: "pass" },
  };
  it("never carries the budget", () => {
    const view = noteView(note)!;
    const text = JSON.stringify(view);
    expect(text).not.toMatch(/18 lakh|20 lakh|Budget/i);
    expect(view.watchOuts).toEqual(["Tight timeline"]);
    expect(view.checks.map((check) => check.id)).toEqual(["C1", "C2", "C3", "C5"]);
  });
  it("labels the useful fields", () => {
    const view = noteView(note)!;
    expect(view.summary).toBe("Young couple, full 3BHK fit-out in Baner");
    expect(view.fields).toContainEqual({ label: "Size", value: "1,400 sq ft" });
    expect(view.fields).toContainEqual({ label: "Decides", value: "Both spouses" });
  });
  it("returns null for an empty or malformed note", () => {
    expect(noteView(null)).toBeNull();
    expect(noteView([])).toBeNull();
    expect(noteView({ budget_mentioned: "10 lakh" })).toBeNull();
  });
});

describe("withAs", () => {
  it("adds as only when set, before any hash", () => {
    expect(withAs("/designer/leads", null)).toBe("/designer/leads");
    expect(withAs("/designer/leads", "abc")).toBe("/designer/leads?as=abc");
    expect(withAs("/designer/calendar?view=day#schedule", "abc")).toBe("/designer/calendar?view=day&as=abc#schedule");
  });
});

describe("performance", () => {
  const me = "me";
  const range = { from: "2026-09-01", to: "2026-09-08" };
  const at = (day: number, hour: number, minute = 0) => new Date(`2026-09-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+05:30`);
  const result = performance({
    me,
    range,
    limitMin: 30,
    designers: 2,
    handoffs: [
      { posted_at: at(1, 10), accepted_at: at(1, 10, 10), accepted_by: me, assigned_to: me },
      { posted_at: at(2, 10), accepted_at: at(2, 11), accepted_by: me, assigned_to: null },
      { posted_at: at(2, 12), accepted_at: null, accepted_by: null, assigned_to: me },
      { posted_at: at(3, 10), accepted_at: at(3, 10, 20), accepted_by: "other", assigned_to: "other" },
    ],
    consults: [
      { start_at: at(1, 11), designer_id: me },
      { start_at: at(4, 11), designer_id: "other" },
      { start_at: at(5, 11), designer_id: "other" },
    ],
    results: [
      { created_at: at(1, 9), result: "won", owner: me },
      { created_at: at(2, 9), result: "lost", owner: me },
      { created_at: at(3, 9), result: "won", owner: "other" },
    ],
  });
  const kpi = (key: string) => result.kpis.find((k) => k.key === key)!;

  it("uses daily buckets for a week", () => {
    expect(result.bucketDays).toBe(1);
    expect(result.buckets).toHaveLength(7);
    expect(bucketsFor({ from: "2026-09-01", to: "2026-10-01" })).toMatchObject({ days: 7, starts: ["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22", "2026-09-29"] });
  });
  it("computes the designer's own numbers", () => {
    expect(kpi("median_accept").mine).toBe(35);
    expect(kpi("within_limit").mine).toBeCloseTo(1 / 3);
    expect(kpi("consultations").mine).toBe(1);
    expect(kpi("won").mine).toBe(1);
    expect(kpi("win_rate").mine).toBe(0.5);
  });
  it("compares with the studio, counts per designer", () => {
    expect(kpi("median_accept").studio).toBe(20);
    expect(kpi("within_limit").studio).toBe(0.5);
    expect(kpi("consultations").studio).toBe(1.5);
    expect(kpi("won").studio).toBe(1);
    expect(kpi("win_rate").studio).toBeCloseTo(2 / 3);
  });
  it("draws a series per bucket", () => {
    expect(kpi("consultations").series.mine).toEqual([1, 0, 0, 0, 0, 0, 0]);
    expect(kpi("median_accept").series.mine.slice(0, 3)).toEqual([10, 60, null]);
    expect(kpi("win_rate").series.mine.slice(0, 3)).toEqual([1, 0.5, 0.5]);
  });
  it("judges a gap by which way is better", () => {
    expect(delta({ unit: "min", better: "lower", mine: 35, studio: 20 })).toEqual({ text: "15 min", tone: "danger", direction: "up" });
    expect(delta({ unit: "pct", better: "higher", mine: 0.6, studio: 0.5 })).toEqual({ text: "10 pp", tone: "ok", direction: "up" });
    expect(delta({ unit: "count", better: "higher", mine: 3, studio: 3 })?.tone).toBe("neutral");
    expect(delta({ unit: "count", better: "higher", mine: 1, studio: null })).toBeNull();
  });
  it("finds a median", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});
