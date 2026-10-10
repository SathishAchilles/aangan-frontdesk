// The structured handoff note (handoffs.note, written by the post-call note writer) as the designer
// area shows it. The budget the caller mentioned is never shown, and any field that names a figure
// is dropped.
import { withoutPrice } from "./redact";

export type NoteView = {
  summary: string | null;
  fields: { label: string; value: string }[];
  watchOuts: string[];
  checks: { id: string; label: string; state: string }[];
};

const FIELDS: [key: string, label: string][] = [
  ["area", "Area"],
  ["property", "Property"],
  ["size_sqft", "Size"],
  ["scope", "Scope"],
  ["timeline", "Timeline"],
  ["decision_maker", "Decides"],
  ["style_or_preferences", "Likes"],
  ["referral", "Referred by"],
];

// Budget (C4) is left out of the checks too: its state says nothing useful without the figure.
const CHECKS: [id: string, label: string][] = [
  ["C1", "Real project"],
  ["C2", "Service area"],
  ["C3", "Timeline"],
  ["C5", "Decision-maker"],
];
const STATES = new Set(["pass", "fail", "unclear", "not_mentioned"]);

export function noteView(raw: unknown): NoteView | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const note = raw as Record<string, unknown>;
  const fields: NoteView["fields"] = [];
  for (const [key, label] of FIELDS) {
    const value = note[key];
    const text = key === "size_sqft" && typeof value === "number" && value > 0 ? `${value.toLocaleString("en-IN")} sq ft` : withoutPrice(value);
    if (text) fields.push({ label, value: text });
  }
  const watchOuts = (Array.isArray(note.watch_outs) ? note.watch_outs : []).map(withoutPrice).filter((text): text is string => text !== null);
  const criteria = note.criteria && typeof note.criteria === "object" ? (note.criteria as Record<string, unknown>) : {};
  const checks = CHECKS.filter(([id]) => typeof criteria[id] === "string" && STATES.has(criteria[id] as string)).map(([id, label]) => ({ id, label, state: criteria[id] as string }));
  const summary = withoutPrice(note.one_line_summary);
  if (!summary && fields.length === 0 && watchOuts.length === 0 && checks.length === 0) return null;
  return { summary, fields, watchOuts, checks };
}
