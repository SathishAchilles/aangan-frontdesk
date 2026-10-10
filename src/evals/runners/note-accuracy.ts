// Eval note-accuracy: the real Gemini note writer on the phone transcripts, compared field by field
// with gold, plus a check that every statement in the note is supported by the transcript.
import { matchLocality } from "../../lib/rules/parse";
import { LOCALITIES } from "../../lib/settings/seed-data";
import { createGeminiNoteWriter } from "../../lib/note";
import { containsPriceFigure } from "../graders/deterministic";
import { datasetVersion, loadJsonl } from "../datasets";
import type { EvalRunner } from "../registry";
import { buildReport } from "../report";
import { goldEnquirySchema, type ItemResult, noteGoldSchema } from "../types";

const STOP = new Set(["with", "that", "this", "they", "their", "have", "want", "wants", "would", "about", "from", "into", "only", "also", "full", "home", "project", "client", "caller", "needs", "them", "what", "when", "will", "were", "been", "some", "done"]);

// A field value is supported when most of its content words appear in the transcript.
export function unsupported(value: string, transcript: string): boolean {
  const words = value.toLowerCase().match(/[a-z]{4,}/g)?.filter((word) => !STOP.has(word)) ?? [];
  if (words.length === 0) return false;
  const haystack = transcript.toLowerCase();
  const found = words.filter((word) => haystack.includes(word.slice(0, Math.max(4, word.length - 2)))).length;
  return found / words.length < 0.6;
}

const present = (value: unknown) => value !== null && value !== undefined && value !== "";

export const noteAccuracy: EvalRunner = async ({ budget }) => {
  const startedAt = new Date();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const model = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
  const writer = createGeminiNoteWriter({ apiKey, model });
  const transcripts = new Map(loadJsonl("phone-transcripts.jsonl", goldEnquirySchema).map((item) => [item.id, item]));
  const gold = loadJsonl("note-gold.jsonl", noteGoldSchema);
  const localities = LOCALITIES.map(({ name, aliases, status }) => ({ name, aliases, status }));

  const items: ItemResult[] = [];
  let fieldsChecked = 0;
  let fieldsRight = 0;
  let unsupportedCount = 0;
  let leaked = 0;
  for (const item of gold) {
    const source = transcripts.get(item.id)!;
    const result = await writer({ transcript: source.transcript, enquiry: { id: item.id, outcome: source.expected_outcome as never, flags: [], facts: {}, criteria: [], consultType: null } });
    budget.charge(model, result.inputTokens, result.outputTokens);
    const note = result.note;
    const checks: Record<string, boolean> = {};
    const goldArea = item.fields.area as string | null;
    checks.area = goldArea
      ? matchLocality(String(note.area ?? ""), localities)?.name === matchLocality(goldArea, localities)?.name && present(note.area)
      : !present(note.area) || matchLocality(String(note.area), localities) === undefined;
    checks.size_sqft = item.fields.size_sqft === null ? !present(note.size_sqft) || Number(note.size_sqft) > 0 : Number(note.size_sqft) === Number(item.fields.size_sqft);
    for (const key of ["timeline", "decision_maker", "budget_mentioned"] as const) {
      checks[key] = (item.fields[key] === "present") === present(note[key]);
    }
    const statements = Object.entries(note)
      .filter(([key, value]) => typeof value === "string" && !["outcome", "one_line_summary"].includes(key))
      .map(([key, value]) => [key, String(value)] as const);
    const notSupported = statements.filter(([, value]) => unsupported(value, source.transcript)).map(([key]) => key);
    const priceLines = Object.values(note).filter((value) => typeof value === "string" && containsPriceFigure(value) && !/lakh|crore/i.test(source.transcript));
    fieldsChecked += Object.keys(checks).length;
    fieldsRight += Object.values(checks).filter(Boolean).length;
    unsupportedCount += notSupported.length;
    leaked += priceLines.length;
    items.push({
      item_id: item.id,
      expected: item.fields,
      actual: note,
      scores: { ...checks, unsupported: notSupported.join(",") || "none" },
      passed: Object.values(checks).every(Boolean) && notSupported.length === 0,
    });
    console.log(`${item.id}: ${Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key).join(",") || "ok"}${notSupported.length ? ` unsupported: ${notSupported.join(",")}` : ""}`);
  }

  return buildReport({
    evalName: "note-accuracy",
    datasetVersion: datasetVersion("note-gold.jsonl", "phone-transcripts.jsonl"),
    startedAt,
    metrics: { notes: gold.length, field_accuracy: fieldsChecked ? fieldsRight / fieldsChecked : 0, unsupported_statements: unsupportedCount, invented_price_figures: leaked },
    thresholds: [
      { metric: "field_accuracy", op: ">=", value: 0.95 },
      { metric: "unsupported_statements", op: "==", value: 0, hard: true },
      { metric: "invented_price_figures", op: "==", value: 0, hard: true },
    ],
    items,
    costInr: budget.spentInr,
  });
};
