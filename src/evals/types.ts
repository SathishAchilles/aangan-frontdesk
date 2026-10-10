import { z } from "zod";

export const OUTCOMES = [
  "QUALIFIED",
  "QUALIFIED_WITH_NOTES",
  "NOT_QUALIFIED",
  "NEEDS_HUMAN",
  "NOT_ENQUIRY",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const provenanceSchema = z.object({
  labeller: z.string().min(1),
  labelled_on: z.iso.date(),
  source: z.string().min(1),
  status: z.enum(["provisional", "confirmed"]),
});

export const goldFactsSchema = z.object({
  intent: z.enum(["new", "existing", "other"]),
  project_type: z.enum(["residential", "commercial", "unknown"]).optional(),
  segment: z.string().optional(),
  scope_text: z.string().optional(),
  rooms: z.array(z.string()).optional(),
  sqft: z.number().positive().optional(),
  locality: z.string().optional(),
  deadline_text: z.string().optional(),
  budget_text: z.string().optional(),
  decision_text: z.string().optional(),
  wants_human: z.boolean().optional(),
  execution: z.enum(["yes", "no", "unknown"]).optional(),
});
export type GoldFacts = z.infer<typeof goldFactsSchema>;

// One labelled enquiry: a phone transcript or a case enquiry from any channel.
export const goldEnquirySchema = z.object({
  id: z.string().regex(/^(T|W|F)\d{2}$/),
  channel: z.enum(["phone", "whatsapp", "web_form"]),
  received_at: z.string().min(1),
  transcript: z.string().min(1),
  facts: goldFactsSchema,
  expected_outcome: z.enum(OUTCOMES),
  expected_reason: z.string().optional(),
  provenance: provenanceSchema,
});
export type GoldEnquiry = z.infer<typeof goldEnquirySchema>;

export const personaSchema = z.object({
  id: z.string().min(1),
  based_on: z.string().optional(),
  brief: z.string().min(1),
  opening_line: z.string().min(1),
  facts: goldFactsSchema,
  expected_outcome: z.enum(OUTCOMES),
  must: z.array(z.string()).default([]),
  must_not: z.array(z.string()).default([]),
  provenance: provenanceSchema,
});
export type Persona = z.infer<typeof personaSchema>;

export const slotConstraintSchema = z.object({
  id: z.string().min(1),
  phrase: z.string().min(1),
  allowed: z.array(
    z.object({
      days: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])),
      from: z.string().regex(/^\d{2}:\d{2}$/),
      to: z.string().regex(/^\d{2}:\d{2}$/),
      not_before: z.iso.date().optional(),
    }),
  ),
  provenance: provenanceSchema,
});

export const noteGoldSchema = z.object({
  id: z.string().regex(/^T\d{2}$/),
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
  provenance: provenanceSchema,
});

export const judgeCalibrationSchema = z.object({
  id: z.string().min(1),
  transcript: z.string().min(1),
  human: z.record(z.string(), z.boolean()),
  provenance: provenanceSchema,
});

export type ItemResult = {
  item_id: string;
  expected: unknown;
  actual: unknown;
  scores: Record<string, number | boolean | string>;
  passed: boolean;
  transcript_ref?: string;
};

export type Threshold = {
  metric: string;
  op: ">=" | "<=" | "==";
  value: number;
  hard?: boolean;
};

export type EvalReport = {
  eval_name: string;
  dataset_version: string;
  commit_sha: string;
  prompt_version: string | null;
  settings_version: number | null;
  started_at: string;
  finished_at: string;
  metrics: Record<string, number>;
  thresholds: Threshold[];
  failed_thresholds: string[];
  passed: boolean;
  cost_inr: number;
  items: ItemResult[];
};
