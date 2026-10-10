import { describe, expect, it } from "vitest";
import type { OfficeConfig } from "../rules/office-time";
import { fromIst } from "../rules/time";
import { acceptanceAction, callbackOverdue, droppedCallbackDue, nurtureDue, outcomeNudgeDue } from "./rules";

const OFFICE: OfficeConfig = { start: "10:00", end: "19:00", days: ["mon", "tue", "wed", "thu", "fri"] };
const at = (day: number, hour: number, minute = 0) => fromIst(2026, 10, day, hour, minute); // 13 Oct is a Tuesday

describe("acceptanceAction", () => {
  const posted = { postedAt: at(13, 11), remindedAt: null, escalatedAt: null };
  it("does nothing before 15 office minutes", () => expect(acceptanceAction(posted, at(13, 11, 14), OFFICE, 15, 30)).toBeNull());
  it("reminds at 15", () => expect(acceptanceAction(posted, at(13, 11, 15), OFFICE, 15, 30)).toBe("remind"));
  it("does not remind twice", () => expect(acceptanceAction({ ...posted, remindedAt: at(13, 11, 15) }, at(13, 11, 20), OFFICE, 15, 30)).toBeNull());
  it("escalates at 30 even if never reminded", () => expect(acceptanceAction(posted, at(13, 11, 31), OFFICE, 15, 30)).toBe("escalate"));
  it("pauses overnight: a 23:00 handoff is reminded at 10:15 next day", () => {
    const night = { postedAt: at(13, 23), remindedAt: null, escalatedAt: null };
    expect(acceptanceAction(night, at(14, 10, 14), OFFICE, 15, 30)).toBeNull();
    expect(acceptanceAction(night, at(14, 10, 15), OFFICE, 15, 30)).toBe("remind");
  });
  it("rolls Friday 18:50 into Monday", () => {
    const friday = { postedAt: at(16, 18, 50), remindedAt: null, escalatedAt: null };
    expect(acceptanceAction(friday, at(17, 12), OFFICE, 15, 30)).toBeNull();
    expect(acceptanceAction(friday, at(19, 10, 5), OFFICE, 15, 30)).toBe("remind");
    expect(acceptanceAction(friday, at(19, 10, 20), OFFICE, 15, 30)).toBe("escalate");
  });
});

describe("callbackOverdue", () => {
  it("is overdue one minute after the promised time", () => {
    expect(callbackOverdue({ dueAt: at(14, 10, 30), escalatedAt: null }, at(14, 10, 31))).toBe(true);
    expect(callbackOverdue({ dueAt: at(14, 10, 30), escalatedAt: null }, at(14, 10, 29))).toBe(false);
    expect(callbackOverdue({ dueAt: at(14, 10, 30), escalatedAt: at(14, 10, 31) }, at(14, 11))).toBe(false);
  });
});

describe("outcomeNudgeDue", () => {
  const consult = { startAt: at(19, 15), nudges: 0, lastNudgeAt: null, hasResult: false };
  it("waits until 10:00 on the next working day", () => {
    expect(outcomeNudgeDue(consult, at(20, 9, 59), OFFICE, 3)).toBe(false);
    expect(outcomeNudgeDue(consult, at(20, 10), OFFICE, 3)).toBe(true);
  });
  it("nudges at most once a day", () => {
    expect(outcomeNudgeDue({ ...consult, nudges: 1, lastNudgeAt: at(20, 10) }, at(20, 16), OFFICE, 3)).toBe(false);
    expect(outcomeNudgeDue({ ...consult, nudges: 1, lastNudgeAt: at(20, 10) }, at(21, 10), OFFICE, 3)).toBe(true);
  });
  it("stops after the maximum or once a result is recorded", () => {
    expect(outcomeNudgeDue({ ...consult, nudges: 3, lastNudgeAt: at(22, 10) }, at(23, 10), OFFICE, 3)).toBe(false);
    expect(outcomeNudgeDue({ ...consult, hasResult: true }, at(20, 10), OFFICE, 3)).toBe(false);
  });
  it("skips the weekend after a Friday consultation", () => {
    expect(outcomeNudgeDue({ ...consult, startAt: at(16, 15) }, at(17, 11), OFFICE, 3)).toBe(false);
    expect(outcomeNudgeDue({ ...consult, startAt: at(16, 15) }, at(19, 10), OFFICE, 3)).toBe(true);
  });
});

describe("nurtureDue", () => {
  it("is due on its date when no task exists", () => {
    expect(nurtureDue({ nurtureDueAt: at(20, 10), hasTask: false }, at(20, 10))).toBe(true);
    expect(nurtureDue({ nurtureDueAt: at(20, 10), hasTask: true }, at(20, 10))).toBe(false);
    expect(nurtureDue({ nurtureDueAt: at(20, 10), hasTask: false }, at(19, 10))).toBe(false);
  });
});

describe("droppedCallbackDue", () => {
  const dropped = { endedAt: at(13, 14), callbackPlacedAt: null, redialled: false };
  it("calls back after the configured minutes, once, unless the caller redialled", () => {
    expect(droppedCallbackDue(dropped, at(13, 14, 4), 5)).toBe(false);
    expect(droppedCallbackDue(dropped, at(13, 14, 5), 5)).toBe(true);
    expect(droppedCallbackDue({ ...dropped, callbackPlacedAt: at(13, 14, 5) }, at(13, 14, 10), 5)).toBe(false);
    expect(droppedCallbackDue({ ...dropped, redialled: true }, at(13, 14, 10), 5)).toBe(false);
  });
});
