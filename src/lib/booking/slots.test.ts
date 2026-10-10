import { describe, expect, it } from "vitest";
import { fromIst } from "../rules/time";
import { parseSlotConstraints, pickSlots, slotAllowed, spokenSlot } from "./slots";

const NOW = fromIst(2026, 10, 13, 14, 0); // Tuesday 13 October 2026
const at = (day: number, hour: number, minute = 0) => fromIst(2026, 10, day, hour, minute).toISOString();
// 14 Oct Wed, 16 Fri, 17 Sat, 18 Sun, 19 Mon

describe("parseSlotConstraints", () => {
  it("reads 'weekdays after 6pm or weekends only' as two windows", () => {
    const constraints = parseSlotConstraints("Weekdays after 6pm or weekends only for us.", NOW);
    expect(slotAllowed(at(14, 18, 30), constraints)).toBe(true);
    expect(slotAllowed(at(14, 11), constraints)).toBe(false);
    expect(slotAllowed(at(17, 11), constraints)).toBe(true);
  });

  it("reads a named day and part of day", () => {
    const constraints = parseSlotConstraints("Koi bhi Saturday subah - Saturday morning is fine", NOW);
    expect(slotAllowed(at(17, 10, 30), constraints)).toBe(true);
    expect(slotAllowed(at(17, 15), constraints)).toBe(false);
    expect(slotAllowed(at(16, 10, 30), constraints)).toBe(false);
  });

  it("reads 'not before the 20th'", () => {
    const constraints = parseSlotConstraints("not before the 20th", NOW);
    expect(constraints.notBefore).toBe("2026-10-20");
    expect(slotAllowed(at(19, 11), constraints)).toBe(false);
    expect(slotAllowed(at(20, 11), constraints)).toBe(true);
  });

  it("reads a date with a month", () => {
    expect(parseSlotConstraints("after the 21st of October", NOW).notBefore).toBe("2026-10-21");
  });

  it("does not mistake a clock time for a date", () => {
    expect(parseSlotConstraints("after 6 pm", NOW).notBefore).toBeUndefined();
  });

  it("allows everything when the caller states no constraint", () => {
    expect(slotAllowed(at(14, 11), parseSlotConstraints("", NOW))).toBe(true);
    expect(slotAllowed(at(14, 11), parseSlotConstraints("any time is fine", NOW))).toBe(true);
  });
});

describe("pickSlots", () => {
  it("picks the first allowed slot per day, up to three", () => {
    const slots = [at(14, 10), at(14, 11), at(16, 10), at(16, 12), at(17, 10), at(19, 10)];
    expect(pickSlots(slots, { windows: [] })).toEqual([at(14, 10), at(16, 10), at(17, 10)]);
  });

  it("skips slots outside the caller's windows", () => {
    const constraints = parseSlotConstraints("weekends only", NOW);
    expect(pickSlots([at(14, 10), at(17, 10), at(18, 11), at(19, 10)], constraints)).toEqual([at(17, 10), at(18, 11)]);
  });

  it("returns nothing when no slot fits", () => {
    expect(pickSlots([at(14, 10)], parseSlotConstraints("weekends only", NOW))).toEqual([]);
  });
});

describe("spokenSlot", () => {
  it("says the day, date and time in IST", () => {
    expect(spokenSlot(at(14, 16))).toBe("Wednesday 14 October at 4 pm");
    expect(spokenSlot(at(17, 10, 30))).toBe("Saturday 17 October at 10:30 am");
    expect(spokenSlot(at(17, 12))).toBe("Saturday 17 October at 12 pm");
  });
});
