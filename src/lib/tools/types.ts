import { z } from "zod";
import { factsSchema } from "../rules/facts";
import type { Facts } from "../rules/facts";
import type { Outcome } from "../rules/gate";
import type { RulesConfig } from "../rules/config";

// Request bodies Vaani's language model fills in. Unknown fields are ignored, not rejected,
// because the model sometimes adds extras.
export const lookupCallerRequest = z.object({
  phone: z.string().optional(),
  vaani_call_id: z.string().optional(),
});

// Vaani sends the fact fields at the top level (as declared in the tool spec); tests and scripts may
// nest them under `facts`. Both are accepted: top-level fact fields are folded into `facts`.
export const evaluateEnquiryRequest = z.preprocess(
  (input) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) return input;
    const { enquiry_id, phone, intent, asked, facts, ...rest } = input as Record<string, unknown>;
    const nested = facts && typeof facts === "object" && !Array.isArray(facts) ? facts : {};
    // The model sometimes fills enquiry_id with a placeholder; anything that is not a UUID is ignored.
    const id = typeof enquiry_id === "string" && z.uuid().safeParse(enquiry_id).success ? enquiry_id : undefined;
    return { enquiry_id: id, phone, intent, asked, facts: { ...rest, ...nested } };
  },
  z.object({
    enquiry_id: z.uuid().optional(),
    phone: z.string().min(1).optional(),
    intent: z.enum(["new", "existing", "other"]).default("new"),
    facts: factsSchema.partial().default({}),
    asked: z.array(z.enum(["C1", "C2", "C3"])).default([]),
  }),
);

export const logIntentRequest = z.object({
  phone: z.string().optional(),
  intent: z.enum(["existing_client", "message"]),
  summary: z.string().min(1).max(2000),
});

export type EnquiryRecord = {
  id: string;
  callerId: string;
  intent: string;
  outcome: Outcome;
  facts: Partial<Facts>;
  asked: ("C1" | "C2" | "C3")[];
  createdAt: Date;
};

export type CallerRecord = { id: string; phoneE164: string; name: string | null };

export type TaskInput = {
  enquiryId?: string;
  kind: "urgent" | "message" | "callback" | "rebook" | "review" | "nurture" | "alert";
  reason: string;
  payload: Record<string, unknown>;
  dueAt?: Date;
};

export interface ToolRepo {
  findCallerByPhone(phoneE164: string): Promise<CallerRecord | null>;
  upsertCaller(phoneE164: string): Promise<CallerRecord>;
  latestEnquiry(callerId: string, since: Date): Promise<EnquiryRecord | null>;
  getEnquiry(id: string): Promise<EnquiryRecord | null>;
  createEnquiry(callerId: string, intent: string): Promise<EnquiryRecord>;
  saveEvaluation(
    id: string,
    patch: {
      intent: string;
      outcome: Outcome;
      facts: Partial<Facts>;
      asked: string[];
      criteria: unknown;
      flags: string[];
      consultType: string | null;
      settingsVersion: number;
    },
  ): Promise<void>;
  createTask(task: TaskInput): Promise<{ id: string }>;
}

export type ToolDeps = {
  repo: ToolRepo;
  now: () => Date;
  settings: () => Promise<{ rules: RulesConfig; version: number }>;
};

// Every response carries a sentence the agent can say, even on errors.
export type ToolResponse = { status: number; body: Record<string, unknown> };
