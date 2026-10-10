// Validates an admin's edit to one setting: type, range, known shape, and rules across settings.
import { z } from "zod";
import { SETTING_DEFINITIONS, type SettingDefinition, SMALL_COMMERCIAL_ACTIONS, UNCLEAR_ACTIONS } from "./definitions";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use HH:MM, 24-hour");
const day = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const positive = z.number().positive();
const chatId = z.number().int().nullable();

// Shapes for JSON settings; anything not listed must at least be valid JSON.
const JSON_SHAPES: Record<string, z.ZodType> = {
  office_hours: z.object({ start: hhmm, end: hhmm }).refine((value) => value.start < value.end, "start must be before end"),
  office_days: z.array(day).min(1).max(7),
  budget_floors: z.object({ residential_per_sqft: positive, single_room: positive, commercial_per_sqft: positive }).strict(),
  unclear_after_question: z.object({ C1: z.enum(UNCLEAR_ACTIONS), C2: z.enum(UNCLEAR_ACTIONS), C3: z.enum(UNCLEAR_ACTIONS) }).strict(),
  telegram_chats: z.object({ designers: chatId, front_desk: chatId, founder: chatId }).strict(),
  calcom_event_types: z.object({ studio: z.number().int().positive().nullable(), site: z.number().int().positive().nullable(), principal: z.number().int().positive().nullable() }).strict(),
  hubspot_stages: z.object({ new: z.string().min(1), booked: z.string().min(1), won: z.string().min(1), lost: z.string().min(1) }).strict(),
  cost_ai_usd_per_m: z.object({ input: z.number().min(0), output: z.number().min(0) }).strict(),
};

export type ValidationResult = { ok: true; value: unknown } | { ok: false; error: string };

export function definitionFor(key: string): SettingDefinition | undefined {
  return SETTING_DEFINITIONS.find((definition) => definition.key === key);
}

// `raw` is what the admin typed (always text from a form).
export function validateSetting(key: string, raw: string): ValidationResult {
  const definition = definitionFor(key);
  if (!definition) return { ok: false, error: `Unknown setting ${key}` };
  const text = raw.trim();
  if (definition.type === "int" || definition.type === "number") {
    const value = Number(text);
    if (!Number.isFinite(value) || text === "") return { ok: false, error: "Enter a number" };
    if (definition.type === "int" && !Number.isInteger(value)) return { ok: false, error: "Enter a whole number" };
    if (definition.min !== undefined && value < definition.min) return { ok: false, error: `Allowed range is ${definition.min} to ${definition.max}` };
    if (definition.max !== undefined && value > definition.max) return { ok: false, error: `Allowed range is ${definition.min} to ${definition.max}` };
    return { ok: true, value };
  }
  if (definition.type === "enum") {
    return definition.options?.includes(text) ? { ok: true, value: text } : { ok: false, error: `Choose one of: ${definition.options?.join(", ")}` };
  }
  if (definition.type === "string") {
    if (key === "after_hours_callback_time") {
      const parsed = hhmm.safeParse(text);
      return parsed.success ? { ok: true, value: text } : { ok: false, error: "use HH:MM, 24-hour" };
    }
    return text ? { ok: true, value: text } : { ok: false, error: "Cannot be empty" };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "Not valid JSON" };
  }
  const shape = JSON_SHAPES[key];
  if (!shape) return { ok: true, value: json };
  const parsed = shape.safeParse(json);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: parsed.error.issues.map((issue) => `${issue.path.join(".") || key}: ${issue.message}`).join("; ") };
}

// Rules that involve more than one setting, checked against the values after the change.
export function crossFieldErrors(values: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const num = (key: string) => Number(values[key]);
  if (num("accept_reminder_min") >= num("accept_escalate_min")) errors.push("The reminder must come before the escalation (accept_reminder_min < accept_escalate_min).");
  if (num("timeline_hard_fail_weeks") >= num("timeline_tight_weeks")) errors.push("timeline_hard_fail_weeks must be smaller than timeline_tight_weeks.");
  if (num("commercial_min_sqft") >= num("commercial_max_sqft")) errors.push("commercial_min_sqft must be smaller than commercial_max_sqft.");
  if (num("retention_recording_days") > num("retention_transcript_days")) errors.push("Recordings cannot be kept longer than transcripts.");
  return errors;
}

// Price quoting is excluded by pricing.md; no setting may ever enable it.
export const FORBIDDEN_SETTING_PATTERN = /pric(e|ing)_(mode|quot)|quote|show_price/i;

export { SMALL_COMMERCIAL_ACTIONS };
