import { describe, expect, it } from "vitest";
import { matchLocality, parseDeadline, parseMoneyInr, parseSqft, type Locality } from "./parse";
import { fromIst, isoDateIst, weeksBetween } from "./time";

const SEP_8 = fromIst(2026, 9, 8, 9, 44);
const FESTIVALS = [
  { name: "Diwali", date: "2026-11-08" },
  { name: "Christmas", date: "2026-12-25" },
];

describe("parseSqft", () => {
  it.each([
    ["About 1,400 sq ft carpet.", 1400],
    ["~920 sq ft (2BHK)", 920],
    ["5,500 sq ft - ground plus two floors", 5500],
    ["800 square feet", 800],
    ["a 180 sq ft pod", 180],
  ])("%s -> %d", (text, expected) => {
    expect(parseSqft(text)).toBe(expected);
  });

  it("returns undefined when no area is given", () => {
    expect(parseSqft("a 3BHK in Aundh")).toBeUndefined();
  });

  it("passes numbers through", () => {
    expect(parseSqft(950)).toBe(950);
  });
});

describe("parseMoneyInr", () => {
  it.each([
    ["1 to 1.5 lakh maximum for everything", 100000, 150000],
    ["₹15–20 lakh for the full home", 1500000, 2000000],
    ["₹60–80 lakh all-in (including furniture)", 6000000, 8000000],
    ["₹35–40 lakh for the above scope", 3500000, 4000000],
    ["4-5 lakh", 400000, 500000],
    ["80 Lakhs", 8000000, 8000000],
    ["around 1.2 crore", 12000000, 12000000],
    ["Rs 500000", 500000, 500000],
    ["18-22 lakh", 1800000, 2200000],
    ["two lakh in total", 200000, 200000],
    ["one and a half lakh max", 150000, 150000],
    ["twenty five lakh", 2500000, 2500000],
    ["a lakh or so", 100000, 100000],
    ["one to one and a half lakh", 100000, 150000],
  ])("%s", (text, min, max) => {
    expect(parseMoneyInr(text)).toEqual({ min, max });
  });

  it.each(["reasonable", "Budget bhi hai", "Prefer not to mention - will discuss", ""])("no figure in %s", (text) => {
    expect(parseMoneyInr(text)).toBeUndefined();
  });
});

describe("parseDeadline", () => {
  it("reads a three-week completion", () => {
    const deadline = parseDeadline("3 weeks maximum", SEP_8);
    expect(deadline.kind).toBe("complete");
    expect(Math.round(weeksBetween(SEP_8, deadline.date!))).toBe(3);
  });

  it("prefers a stated duration over the festival date", () => {
    const deadline = parseDeadline("before Diwali, which is about three weeks away", SEP_8, FESTIVALS);
    expect(Math.round(weeksBetween(SEP_8, deadline.date!))).toBe(3);
  });

  it("resolves a festival from the table when no duration is stated", () => {
    const deadline = parseDeadline("before Diwali", SEP_8, FESTIVALS);
    expect(deadline.kind).toBe("complete");
    expect(isoDateIst(deadline.date!)).toBe("2026-11-08");
  });

  it("reads 'done by March' as the end of next March", () => {
    const deadline = parseDeadline("We'd like to be done by March. We're in no rush.", SEP_8);
    expect(deadline.kind).toBe("complete");
    expect(isoDateIst(deadline.date!)).toBe("2027-03-31");
  });

  it("reads a month with an explicit year", () => {
    expect(isoDateIst(parseDeadline("Move in by March 2027.", SEP_8).date!)).toBe("2027-03-31");
  });

  it("treats 'a January start for execution' as a start date", () => {
    const deadline = parseDeadline("We're flexible - a January start for execution would be ideal.", SEP_8);
    expect(deadline.kind).toBe("start");
    expect(isoDateIst(deadline.date!)).toBe("2027-01-31");
  });

  it("treats a move-in month as a completion", () => {
    const deadline = parseDeadline("We move in November - so maybe starting design from October?", SEP_8);
    expect(deadline.kind).toBe("complete");
    expect(isoDateIst(deadline.date!)).toBe("2026-11-30");
  });

  it("reads months as durations", () => {
    const deadline = parseDeadline("3-4 months, flexible", SEP_8);
    expect(deadline.kind).toBe("complete");
    expect(Math.round(weeksBetween(SEP_8, deadline.date!))).toBe(17);
  });

  it("reads 'start immediately' as a start now", () => {
    expect(parseDeadline("Ready to start immediately.", SEP_8).kind).toBe("start");
  });

  it("reads 'as soon as possible' without a start word as vague", () => {
    expect(parseDeadline("as soon as possible", SEP_8).kind).toBe("asap");
  });

  it("reads no deadline as flexible", () => {
    expect(parseDeadline("No specific deadline - whenever we can start.", SEP_8).kind).toBe("flexible");
  });

  it("returns unknown for empty or unrelated text", () => {
    expect(parseDeadline(undefined, SEP_8).kind).toBe("unknown");
    expect(parseDeadline("we like warm colours", SEP_8).kind).toBe("unknown");
  });
});

describe("matchLocality", () => {
  const localities: Locality[] = [
    { name: "Kothrud", aliases: ["dahanukar colony"], status: "in" },
    { name: "Pimple Saudagar", aliases: [], status: "in" },
    { name: "Pimple Nilakh", aliases: [], status: "in" },
    { name: "Talegaon", aliases: ["talegaon dabhade"], status: "out" },
    { name: "Nashik", aliases: ["nasik"], status: "out" },
    { name: "Hinjewadi", aliases: ["hinjewadi phase 1"], status: "in" },
  ];

  it.each([
    ["Kothrud - Dahanukar Colony", "Kothrud", "in"],
    ["Ritu Kapoor from Pimple Saudagar", "Pimple Saudagar", "in"],
    ["Talegaon Dabhade, near Pune", "Talegaon", "out"],
    ["I'm in Nashik", "Nashik", "out"],
    ["Hinjewadi Phase 1, Pune", "Hinjewadi", "in"],
  ])("%s -> %s", (text, name, status) => {
    expect(matchLocality(text, localities)).toEqual({ name, status });
  });

  it("returns undefined for an unknown place", () => {
    expect(matchLocality("somewhere near the highway", localities)).toBeUndefined();
  });
});
