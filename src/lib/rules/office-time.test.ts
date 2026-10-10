import { describe, expect, it } from "vitest";
import {
  addOfficeMinutes,
  describeCallback,
  isOfficeOpen,
  nextOfficeOpen,
  officeMinutesBetween,
  type OfficeConfig,
} from "./office-time";
import { fromIst, istParts } from "./time";

const OFFICE: OfficeConfig = { start: "10:00", end: "19:00", days: ["mon", "tue", "wed", "thu", "fri"] };
// 2026-10-13 is a Tuesday; 2026-10-16 a Friday; 2026-10-17 a Saturday.
const TUE_14 = fromIst(2026, 10, 13, 14, 0);
const TUE_23 = fromIst(2026, 10, 13, 23, 0);
const FRI_1850 = fromIst(2026, 10, 16, 18, 50);
const SAT_11 = fromIst(2026, 10, 17, 11, 0);

const ist = (date: Date) => {
  const p = istParts(date);
  return `${p.weekday} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};

describe("isOfficeOpen", () => {
  it("is open on a weekday afternoon", () => expect(isOfficeOpen(TUE_14, OFFICE)).toBe(true));
  it("is closed at night", () => expect(isOfficeOpen(TUE_23, OFFICE)).toBe(false));
  it("is closed on Saturday", () => expect(isOfficeOpen(SAT_11, OFFICE)).toBe(false));
  it("is closed exactly at closing time", () => expect(isOfficeOpen(fromIst(2026, 10, 13, 19, 0), OFFICE)).toBe(false));
  it("is closed on a configured holiday", () =>
    expect(isOfficeOpen(TUE_14, { ...OFFICE, holidays: ["2026-10-13"] })).toBe(false));
});

describe("nextOfficeOpen", () => {
  it("returns now while open", () => expect(nextOfficeOpen(TUE_14, OFFICE)).toEqual(TUE_14));
  it("returns 10:00 next morning after hours", () => expect(ist(nextOfficeOpen(TUE_23, OFFICE))).toBe("wed 10:00"));
  it("skips the weekend", () => expect(ist(nextOfficeOpen(SAT_11, OFFICE))).toBe("mon 10:00"));
});

describe("addOfficeMinutes", () => {
  it("adds minutes inside the same day", () => expect(ist(addOfficeMinutes(TUE_14, 30, OFFICE))).toBe("tue 14:30"));
  it("starts the clock at opening time for a night handoff", () =>
    expect(ist(addOfficeMinutes(TUE_23, 15, OFFICE))).toBe("wed 10:15"));
  it("rolls Friday 18:50 + 30 into Monday", () => expect(ist(addOfficeMinutes(FRI_1850, 30, OFFICE))).toBe("mon 10:20"));
});

describe("officeMinutesBetween", () => {
  it("counts only office time", () => {
    expect(officeMinutesBetween(FRI_1850, fromIst(2026, 10, 19, 10, 20), OFFICE)).toBe(30);
    expect(officeMinutesBetween(TUE_23, fromIst(2026, 10, 14, 10, 15), OFFICE)).toBe(15);
    expect(officeMinutesBetween(TUE_14, TUE_14, OFFICE)).toBe(0);
  });
});

describe("describeCallback", () => {
  it("promises minutes during office hours", () => {
    expect(describeCallback(TUE_14, OFFICE, 30, "10:30").words).toBe("within 30 minutes");
  });
  it("promises tomorrow morning at night", () => {
    const promise = describeCallback(TUE_23, OFFICE, 30, "10:30");
    expect(promise.words).toBe("by 10:30 tomorrow morning");
    expect(ist(promise.at)).toBe("wed 10:30");
  });
  it("names the day across a weekend", () => {
    expect(describeCallback(SAT_11, OFFICE, 30, "10:30").words).toBe("by 10:30 on Monday morning");
  });
  it("says this morning before opening", () => {
    expect(describeCallback(fromIst(2026, 10, 13, 8, 0), OFFICE, 30, "10:30").words).toBe("by 10:30 this morning");
  });
});
