import { describe, expect, it } from "vitest";
import { addDays, changePct, changePp, designerInsight, overviewRange, priorRange, rangeDays } from "./insights";
import type { DesignerRow } from "./metrics";

const row = (name: string, assigned: number, median: number | null): DesignerRow => ({
  id: name,
  name,
  assigned,
  median_accept_minutes: median,
  escalations: 0,
  won: 0,
  lost: 0,
  won_rate: null,
});

describe("overview range", () => {
  it("defaults to the last 14 IST days, today included", () => {
    // 11 Oct 2026, 23:30 IST is still 11 Oct in IST (18:00 UTC).
    expect(overviewRange({}, new Date("2026-10-11T18:00:00Z"))).toEqual({ from: "2026-09-28", to: "2026-10-12" });
    // 12 Oct 2026, 00:30 IST is already the next IST day.
    expect(overviewRange({}, new Date("2026-10-11T19:00:00Z"))).toEqual({ from: "2026-09-29", to: "2026-10-13" });
  });

  it("keeps valid params and replaces invalid or reversed ones", () => {
    const now = new Date("2026-10-11T06:00:00Z");
    expect(overviewRange({ from: "2026-09-01", to: "2026-10-01" }, now)).toEqual({ from: "2026-09-01", to: "2026-10-01" });
    expect(overviewRange({ to: "2026-10-01" }, now)).toEqual({ from: "2026-09-17", to: "2026-10-01" });
    expect(overviewRange({ from: "2026-02-31", to: "2026-03-05" }, now)).toEqual({ from: "2026-02-19", to: "2026-03-05" });
    expect(overviewRange({ from: "2026-10-05", to: "2026-10-05" }, now)).toEqual({ from: "2026-09-28", to: "2026-10-12" });
  });

  it("finds the prior period of equal length, across month and year ends", () => {
    expect(priorRange({ from: "2026-09-28", to: "2026-10-12" })).toEqual({ from: "2026-09-14", to: "2026-09-28" });
    expect(priorRange({ from: "2026-09-01", to: "2026-10-01" })).toEqual({ from: "2026-08-02", to: "2026-09-01" });
    expect(priorRange({ from: "2026-01-01", to: "2026-01-08" })).toEqual({ from: "2025-12-25", to: "2026-01-01" });
    expect(rangeDays({ from: "2026-03-01", to: "2026-04-01" })).toBe(31);
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("period changes", () => {
  it("gives percent change for counts and points for rates, null without a baseline", () => {
    expect(changePct(40, 24)).toBeCloseTo(66.667, 2);
    expect(changePct(12, 16)).toBe(-25);
    expect(changePct(5, 0)).toBeNull();
    expect(changePct(0, 0)).toBeNull();
    expect(changePp(0.469, 0.586)).toBeCloseTo(-11.7, 6);
    expect(changePp(0.5, null)).toBeNull();
  });
});

describe("designer insight", () => {
  it("names the designer with the most leads and the slowest median accept time", () => {
    expect(designerInsight([row("Designer 1 (principal)", 35, 21), row("Designer 2", 13, 10), row("Designer 3", 14, 10)])).toBe(
      "Designer 1 carries 56% of assigned leads (35 of 62) and is the slowest to accept a handoff, at 21 min median.",
    );
    expect(designerInsight([row("Asha", 10, 8), row("Ravi", 5, 30.5)])).toBe("Asha carries 67% of assigned leads (10 of 15); Ravi is the slowest to accept a handoff, at 30.5 min median.");
  });

  it("leaves out claims the data cannot support", () => {
    expect(designerInsight([])).toBeNull();
    expect(designerInsight([row("Asha", 0, null), row("Ravi", 0, null)])).toBeNull();
    // A tie on leads and on accept time: nothing to say.
    expect(designerInsight([row("Asha", 5, 10), row("Ravi", 5, 10)])).toBeNull();
    // A tie on leads, a clear slowest.
    expect(designerInsight([row("Asha", 5, 10), row("Ravi", 5, 20)])).toBe("Ravi is the slowest to accept a handoff, at 20 min median.");
    // Only one designer has an accept time: no "slowest".
    expect(designerInsight([row("Asha", 6, 10), row("Ravi", 2, null)])).toBe("Asha carries 75% of assigned leads (6 of 8).");
    // A single designer carries everything: no comparison to make.
    expect(designerInsight([row("Asha", 6, 10)])).toBeNull();
  });
});
