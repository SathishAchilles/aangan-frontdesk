import { describe, expect, it } from "vitest";
import { envSchema } from "../env";
import { SETTING_DEFINITIONS } from "./definitions";
import { crossFieldErrors, FORBIDDEN_SETTING_PATTERN, validateSetting } from "./validate";

const defaults = Object.fromEntries(SETTING_DEFINITIONS.map((definition) => [definition.key, definition.default]));

describe("validateSetting", () => {
  it("accepts a valid number inside its range", () => expect(validateSetting("accept_escalate_min", "45")).toEqual({ ok: true, value: 45 }));
  it("rejects a number outside its range and names the range", () => {
    expect(validateSetting("budget_clearly_below_pct", "5")).toEqual({ ok: false, error: "Allowed range is 20 to 90" });
  });
  it("rejects a fraction for a whole-number setting", () => expect(validateSetting("accept_reminder_min", "7.5").ok).toBe(false));
  it("checks enum options", () => {
    expect(validateSetting("commercial_below_min_action", "decline")).toEqual({ ok: true, value: "decline" });
    expect(validateSetting("commercial_below_min_action", "maybe").ok).toBe(false);
  });
  it("checks the shape of JSON settings", () => {
    expect(validateSetting("office_hours", '{"start":"10:00","end":"19:00"}').ok).toBe(true);
    expect(validateSetting("office_hours", '{"start":"19:00","end":"10:00"}').ok).toBe(false);
    expect(validateSetting("office_days", '["mon","funday"]').ok).toBe(false);
    expect(validateSetting("unclear_after_question", '{"C1":"needs_human","C2":"needs_human","C3":"qualified_with_notes"}').ok).toBe(true);
    expect(validateSetting("budget_floors", '{"residential_per_sqft":0,"single_room":1,"commercial_per_sqft":1}').ok).toBe(false);
    expect(validateSetting("telegram_chats", "not json")).toEqual({ ok: false, error: "Not valid JSON" });
  });
  it("checks the callback time format", () => {
    expect(validateSetting("after_hours_callback_time", "10:30").ok).toBe(true);
    expect(validateSetting("after_hours_callback_time", "half ten").ok).toBe(false);
  });
  it("rejects unknown keys", () => expect(validateSetting("pricing_mode", "on").ok).toBe(false));
  it("accepts every seeded default", () => {
    for (const definition of SETTING_DEFINITIONS) {
      const raw = typeof definition.default === "string" ? definition.default : JSON.stringify(definition.default);
      expect(validateSetting(definition.key, raw).ok, definition.key).toBe(true);
    }
  });
});

describe("crossFieldErrors", () => {
  it("passes the defaults", () => expect(crossFieldErrors(defaults)).toEqual([]));
  it("rejects a reminder at or after the escalation", () => {
    expect(crossFieldErrors({ ...defaults, accept_reminder_min: 40 })).toHaveLength(1);
  });
  it("rejects a hard-fail timeline not below the tight timeline", () => {
    expect(crossFieldErrors({ ...defaults, timeline_hard_fail_weeks: 12 })[0]).toMatch(/timeline_hard_fail_weeks/);
  });
});

describe("price quoting can never be enabled", () => {
  it("has no setting for it", () => {
    expect(SETTING_DEFINITIONS.filter((definition) => FORBIDDEN_SETTING_PATTERN.test(definition.key))).toEqual([]);
  });
  it("has no environment variable for it", () => {
    expect(Object.keys(envSchema.shape).filter((key) => /PRIC|QUOTE/i.test(key))).toEqual([]);
  });
});
