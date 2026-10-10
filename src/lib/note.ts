// Post-call handoff note by Gemini. It copies the live outcome and never changes it; a disagreement
// between its independent re-read and the live gate only raises a review task.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GoogleGenAI, Type } from "@google/genai";
import type { CriterionResult } from "./rules/facts";
import type { LinkedEnquiry, NoteResult, NoteWriter } from "./pipeline/vaani-events";

const STATES = ["pass", "fail", "unclear", "not_mentioned"];

export const noteSchema = {
  type: Type.OBJECT,
  properties: {
    client_name: { type: Type.STRING, nullable: true },
    area: { type: Type.STRING, nullable: true },
    property: { type: Type.STRING, nullable: true, description: "e.g. 3BHK apartment, villa, office" },
    size_sqft: { type: Type.NUMBER, nullable: true },
    scope: { type: Type.STRING, nullable: true, description: "What they want done" },
    timeline: { type: Type.STRING, nullable: true },
    decision_maker: { type: Type.STRING, nullable: true },
    budget_mentioned: { type: Type.STRING, nullable: true },
    style_or_preferences: { type: Type.STRING, nullable: true },
    referral: { type: Type.STRING, nullable: true },
    watch_outs: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Things the designer should know, e.g. frustrated, tight timeline" },
    one_line_summary: { type: Type.STRING },
    criteria: {
      type: Type.OBJECT,
      properties: Object.fromEntries(["C1", "C2", "C3", "C4", "C5"].map((id) => [id, { type: Type.STRING, enum: STATES }])),
      required: ["C1", "C2", "C3", "C4", "C5"],
    },
  },
  required: ["one_line_summary", "criteria", "watch_outs"],
};

// Two states disagree only when one says pass and the other fail; unclear vs pass is not a conflict.
export function disagreements(live: CriterionResult[], reread: Record<string, string>): string[] {
  return live
    .filter((criterion) => {
      const other = reread[criterion.id];
      return (criterion.state === "pass" && other === "fail") || (criterion.state === "fail" && other === "pass");
    })
    .map((criterion) => criterion.id);
}

export function createGeminiNoteWriter(options: { apiKey: string; model: string; promptPath?: string }): NoteWriter {
  const client = new GoogleGenAI({ apiKey: options.apiKey });
  const system = readFileSync(options.promptPath ?? join(process.cwd(), "prompts", "note.md"), "utf8");
  return async ({ transcript, enquiry }: { transcript: string; enquiry: LinkedEnquiry }): Promise<NoteResult> => {
    const response = await client.models.generateContent({
      model: options.model,
      contents: `LIVE OUTCOME (already decided, do not change): ${enquiry.outcome}\n\nTRANSCRIPT:\n<<<\n${transcript}\n>>>`,
      config: { systemInstruction: system, temperature: 0, responseMimeType: "application/json", responseSchema: noteSchema },
    });
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((part) => part.text ?? "").join("");
    const note = JSON.parse(text || "{}") as Record<string, unknown> & { criteria?: Record<string, string> };
    const live = (Array.isArray(enquiry.criteria) ? enquiry.criteria : []) as CriterionResult[];
    return {
      note: { ...note, outcome: enquiry.outcome },
      disagreements: disagreements(live, note.criteria ?? {}),
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    };
  };
}
