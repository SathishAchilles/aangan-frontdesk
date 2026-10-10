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

export const evaluateEnquiryRequest = z.object({
  enquiry_id: z.uuid().optional(),
  phone: z.string().min(1),
  intent: z.enum(["new", "existing", "other"]).default("new"),
  facts: factsSchema.partial().default({}),
  asked: z.array(z.enum(["C1", "C2", "C3"])).default([]),
});

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
  kind: "urgent" | "message" | "callback";
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
