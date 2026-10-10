// Everything the gate needs besides the caller's facts: settings plus reference data.
import { SETTING_DEFINITIONS, type SMALL_COMMERCIAL_ACTIONS, type UNCLEAR_ACTIONS } from "../settings/definitions";
import { FESTIVAL_DATES, LOCALITIES } from "../settings/seed-data";
import type { OfficeConfig } from "./office-time";
import type { Festival, Locality } from "./parse";
import type { DayKey } from "./time";

export type UnclearAction = (typeof UNCLEAR_ACTIONS)[number];
export type SmallCommercialAction = (typeof SMALL_COMMERCIAL_ACTIONS)[number];

export type RulesConfig = {
  timelineHardFailWeeks: number;
  timelineTightWeeks: number;
  budgetClearlyBelowPct: number;
  budgetFloors: { residential_per_sqft: number; single_room: number; commercial_per_sqft: number };
  commercialMaxSqft: number;
  commercialMinSqft: number;
  commercialBelowMinAction: SmallCommercialAction;
  unclearAfterQuestion: { C1: UnclearAction; C2: UnclearAction; C3: UnclearAction };
  principalVisitMinSqft: number;
  office: OfficeConfig;
  callbackWithinMin: number;
  afterHoursCallbackTime: string;
  seniorCallbackWithinMin: number;
  localities: Locality[];
  festivals: Festival[];
};

export type SettingValues = Record<string, unknown>;

export function rulesConfigFromSettings(
  values: SettingValues,
  localities: Locality[],
  festivals: Festival[],
): RulesConfig {
  const get = <T>(key: string): T => {
    if (!(key in values)) throw new Error(`Missing setting ${key}`);
    return values[key] as T;
  };
  const hours = get<{ start: string; end: string }>("office_hours");
  return {
    timelineHardFailWeeks: get("timeline_hard_fail_weeks"),
    timelineTightWeeks: get("timeline_tight_weeks"),
    budgetClearlyBelowPct: get("budget_clearly_below_pct"),
    budgetFloors: get("budget_floors"),
    commercialMaxSqft: get("commercial_max_sqft"),
    commercialMinSqft: get("commercial_min_sqft"),
    commercialBelowMinAction: get("commercial_below_min_action"),
    unclearAfterQuestion: get("unclear_after_question"),
    principalVisitMinSqft: get("principal_visit_min_sqft"),
    office: { start: hours.start, end: hours.end, days: get<DayKey[]>("office_days") },
    callbackWithinMin: get("callback_within_min"),
    afterHoursCallbackTime: get("after_hours_callback_time"),
    seniorCallbackWithinMin: 15,
    localities,
    festivals,
  };
}

// Defaults straight from the definitions and seed data; used by tests and offline evals.
export function defaultRulesConfig(): RulesConfig {
  const values = Object.fromEntries(SETTING_DEFINITIONS.map((definition) => [definition.key, definition.default]));
  return rulesConfigFromSettings(
    values,
    LOCALITIES.map(({ name, aliases, status }) => ({ name, aliases, status })),
    FESTIVAL_DATES.map(({ name, date }) => ({ name, date })),
  );
}
