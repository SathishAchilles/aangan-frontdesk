import { z } from "zod";

// What the voice agent extracts from the caller. Free text is kept verbatim as evidence; the
// rules engine, not the language model, decides what it means.
export const factsSchema = z.object({
  intent: z.enum(["new", "existing", "other"]).default("new"),
  project_type: z.enum(["residential", "commercial", "unknown"]).optional(),
  segment: z.string().optional(),
  work_type: z
    .enum(["design_execution", "advice_only", "decor_only", "furniture_only", "vastu_only", "structural"])
    .optional(),
  execution: z.enum(["yes", "no", "unknown"]).optional(),
  scope_text: z.string().optional(),
  rooms: z.array(z.string()).optional(),
  full_home: z.boolean().optional(),
  property_kind: z.enum(["apartment", "villa", "independent_house", "office", "other"]).optional(),
  sqft: z.number().positive().optional(),
  locality: z.string().optional(),
  deadline_text: z.string().optional(),
  budget_text: z.string().optional(),
  decision_text: z.string().optional(),
  wants_human: z.boolean().optional(),
  wants_site_visit: z.boolean().optional(),
  referral_text: z.string().optional(),
  frustrated: z.boolean().optional(),
});

export type Facts = z.infer<typeof factsSchema>;

export const CRITERIA = ["C1", "C2", "C3", "C4", "C5"] as const;
export type CriterionId = (typeof CRITERIA)[number];
export type AskableCriterion = "C1" | "C2" | "C3";
export type CriterionState = "pass" | "fail" | "unclear" | "not_mentioned";

export type CriterionResult = {
  id: CriterionId;
  state: CriterionState;
  reason: string;
  evidence: string;
};
