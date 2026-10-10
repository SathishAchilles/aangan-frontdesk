// Vaani call lifecycle events -> calls, costs, safety checks, the handoff note and routing.
// Every step is idempotent: a re-delivered or re-processed event changes nothing.
import { z } from "zod";
import { asksAboutBudget, containsPriceFigure } from "../../evals/graders/deterministic";
import { describeCallback } from "../rules/office-time";
import type { RulesConfig } from "../rules/config";
import type { Outcome } from "../rules/gate";
import { addDays } from "../rules/time";
import { toE164 } from "../phone";
import type { TaskInput } from "../tools/types";

export const vaaniEventSchema = z
  .object({
    event: z.string(),
    room_name: z.string().optional(),
    call_id: z.string().optional(),
    phone_number: z.string().optional(),
    call_duration: z.number().optional(),
    end_reason: z.string().optional(),
    reason: z.string().optional(),
    timestamp: z.string().optional(),
    data: z
      .object({
        room_name: z.string().optional(),
        call_id: z.string().optional(),
        call_duration: z.number().optional(),
        end_reason: z.string().optional(),
        summary: z.string().optional(),
        transcript: z.string().optional(),
        recording_url: z.string().optional(),
        entities: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type VaaniEvent = z.infer<typeof vaaniEventSchema>;

export function vaaniCallId(event: VaaniEvent): string | undefined {
  return event.room_name ?? event.call_id ?? event.data?.room_name ?? event.data?.call_id;
}

export function vaaniExternalId(event: VaaniEvent): string {
  return `${event.event}:${vaaniCallId(event) ?? "unknown"}${event.reason ? `:${event.reason}` : ""}`;
}

export type CallRow = { id: string; vaaniCallId: string; callerId: string | null; enquiryId: string | null; startedAt: Date | null; durationS: number | null };
export type LinkedEnquiry = { id: string; outcome: Outcome; flags: string[]; facts: Record<string, unknown>; criteria: unknown; consultType: string | null };

export interface PipelineRepo {
  upsertCall(vaaniCallId: string, patch: Partial<{ callerId: string; direction: "in" | "out"; startedAt: Date; endedAt: Date; durationS: number; endReason: string; transcript: string; summary: string; recordingUrl: string; dropped: boolean; graderFlags: Record<string, unknown>; enquiryId: string }>): Promise<CallRow>;
  upsertCaller(phoneE164: string): Promise<string>;
  findEnquiryForCall(callerId: string, since: Date): Promise<LinkedEnquiry | null>;
  hasCostLines(callId: string, kind: string): Promise<boolean>;
  addCostLine(line: { callId: string; enquiryId: string | null; kind: "telephony_min" | "agent_min" | "ai_in_tok" | "ai_out_tok"; qty: number; unitPriceInr: number }): Promise<void>;
  hasOpenTask(enquiryId: string | null, kind: TaskInput["kind"], callId?: string): Promise<boolean>;
  createTask(task: TaskInput): Promise<{ id: string }>;
  ensureHandoff(enquiryId: string, note: unknown): Promise<"created" | "exists">;
  handoffHasNote(enquiryId: string): Promise<boolean>;
  updateEnquiry(id: string, patch: { flags?: string[]; nurtureDueAt?: Date }): Promise<void>;
}

export type NoteResult = { note: Record<string, unknown>; disagreements: string[]; inputTokens: number; outputTokens: number };
export type NoteWriter = (input: { transcript: string; enquiry: LinkedEnquiry }) => Promise<NoteResult>;

export type PipelineDeps = {
  repo: PipelineRepo;
  now: () => Date;
  settings: () => Promise<{ rules: RulesConfig; values: Record<string, unknown> }>;
  writeNote?: NoteWriter;
};

const BOOKED_OR_QUALIFIED = new Set(["QUALIFIED", "QUALIFIED_WITH_NOTES"]);

// Agent lines from Vaani's "[hh:mm:ss] AGENT: ..." transcript format.
export function agentLines(transcript: string): string[] {
  return [...transcript.matchAll(/\]\s*AGENT:\s*([\s\S]*?)(?=\n\s*\[|\s*$)/g)].map((match) => match[1].trim());
}

export function safetyFlags(transcript: string): { price_figure: string[]; budget_question: string[] } {
  const lines = agentLines(transcript);
  return { price_figure: lines.filter(containsPriceFigure), budget_question: lines.filter(asksAboutBudget) };
}

async function linkEnquiry(deps: PipelineDeps, call: CallRow): Promise<LinkedEnquiry | null> {
  if (!call.callerId) return null;
  const { values } = await deps.settings();
  const windowMin = Number(values.merge_window_minutes ?? 60);
  const since = new Date((call.startedAt ?? deps.now()).getTime() - windowMin * 60_000);
  const enquiry = await deps.repo.findEnquiryForCall(call.callerId, since);
  if (enquiry && call.enquiryId !== enquiry.id) await deps.repo.upsertCall(call.vaaniCallId, { enquiryId: enquiry.id });
  return enquiry;
}

async function recordMinutes(deps: PipelineDeps, call: CallRow, seconds: number, enquiryId: string | null) {
  const { values } = await deps.settings();
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  const lines: ["agent_min" | "telephony_min", number][] = [
    ["agent_min", Number(values.cost_agent_inr_per_min ?? 0)],
    ["telephony_min", Number(values.cost_telephony_inr_per_min ?? 0)],
  ];
  for (const [kind, price] of lines) {
    if (await deps.repo.hasCostLines(call.id, kind)) continue;
    await deps.repo.addCostLine({ callId: call.id, enquiryId, kind, qty: minutes, unitPriceInr: price });
  }
}

export type ProcessResult = { handled: string; actions: string[] };

export async function processVaaniEvent(event: VaaniEvent, deps: PipelineDeps): Promise<ProcessResult> {
  const id = vaaniCallId(event);
  if (!id) return { handled: "ignored", actions: ["no call id"] };
  const now = deps.now();
  const actions: string[] = [];
  const direction = id.startsWith("outbound") ? "out" : "in";

  switch (event.event) {
    case "call_started": {
      const phone = toE164(event.phone_number);
      const callerId = phone ? await deps.repo.upsertCaller(phone) : undefined;
      await deps.repo.upsertCall(id, { direction, startedAt: now, ...(callerId ? { callerId } : {}) });
      return { handled: "call_started", actions: [callerId ? "caller linked" : "no caller id"] };
    }
    case "call_ended": {
      const seconds = event.call_duration ?? 0;
      const call = await deps.repo.upsertCall(id, { direction, endedAt: now, durationS: Math.round(seconds), endReason: event.end_reason });
      const enquiry = await linkEnquiry(deps, call);
      await recordMinutes(deps, call, seconds, enquiry?.id ?? null);
      actions.push(`minutes recorded (${Math.ceil(seconds / 60)})`);
      if (enquiry?.outcome === "PENDING") {
        await deps.repo.upsertCall(id, { dropped: true });
        actions.push("dropped before an outcome");
      }
      return { handled: "call_ended", actions };
    }
    case "call_postprocessing": {
      const data = event.data ?? {};
      const transcript = data.transcript ?? "";
      const flags = safetyFlags(transcript);
      const durationS = data.call_duration !== undefined ? Math.round(data.call_duration / 1000) : undefined;
      const call = await deps.repo.upsertCall(id, {
        direction,
        transcript,
        summary: data.summary,
        recordingUrl: data.recording_url,
        graderFlags: flags,
      });
      if (call.durationS === null && durationS !== undefined) {
        await deps.repo.upsertCall(id, { durationS });
        await recordMinutes(deps, { ...call, durationS }, durationS, call.enquiryId);
      }
      if ((flags.price_figure.length > 0 || flags.budget_question.length > 0) && !(await deps.repo.hasOpenTask(null, "alert", call.id))) {
        await deps.repo.createTask({
          enquiryId: call.enquiryId ?? undefined,
          kind: "alert",
          reason: "Safety check failed: the agent said a price figure or asked about budget",
          payload: { call_id: call.id, vaani_call_id: id, ...flags, notify: ["founder"] },
        });
        actions.push("safety alert");
      }

      const enquiry = await linkEnquiry(deps, call);
      if (!enquiry) return { handled: "call_postprocessing", actions: [...actions, "no enquiry linked"] };
      await route(enquiry, transcript, call, deps, actions, now);
      return { handled: "call_postprocessing", actions };
    }
    case "human_transfer_failed": {
      const call = await deps.repo.upsertCall(id, { direction });
      const enquiry = await linkEnquiry(deps, call);
      if (!(await deps.repo.hasOpenTask(enquiry?.id ?? null, "callback", call.id))) {
        const { rules } = await deps.settings();
        const promise = describeCallback(now, rules.office, rules.callbackWithinMin, rules.afterHoursCallbackTime);
        await deps.repo.createTask({
          enquiryId: enquiry?.id,
          kind: "callback",
          reason: `Transfer to the front desk failed (${event.reason ?? "no answer"})`,
          payload: { call_id: call.id, vaani_call_id: id },
          dueAt: promise.at,
        });
        actions.push("callback task");
      }
      return { handled: "human_transfer_failed", actions };
    }
    default:
      return { handled: "ignored", actions: [`event ${event.event}`] };
  }
}

async function route(enquiry: LinkedEnquiry, transcript: string, call: CallRow, deps: PipelineDeps, actions: string[], now: Date) {
  const flags = new Set(enquiry.flags);
  if (BOOKED_OR_QUALIFIED.has(enquiry.outcome)) {
    let note: unknown = null;
    if (deps.writeNote && transcript && !(await deps.repo.handoffHasNote(enquiry.id))) {
      const result = await deps.writeNote({ transcript, enquiry });
      note = result.note;
      const { values } = await deps.settings();
      const prices = (values.cost_ai_usd_per_m ?? { input: 0, output: 0 }) as { input: number; output: number };
      const inrPerUsd = Number(values.inr_per_usd ?? 88);
      if (!(await deps.repo.hasCostLines(call.id, "ai_in_tok"))) {
        await deps.repo.addCostLine({ callId: call.id, enquiryId: enquiry.id, kind: "ai_in_tok", qty: result.inputTokens, unitPriceInr: (prices.input * inrPerUsd) / 1_000_000 });
        await deps.repo.addCostLine({ callId: call.id, enquiryId: enquiry.id, kind: "ai_out_tok", qty: result.outputTokens, unitPriceInr: (prices.output * inrPerUsd) / 1_000_000 });
      }
      if (result.disagreements.length > 0 && !(await deps.repo.hasOpenTask(enquiry.id, "review"))) {
        await deps.repo.createTask({
          enquiryId: enquiry.id,
          kind: "review",
          reason: `Post-call note disagrees with the live gate on ${result.disagreements.join(", ")}; the live outcome stands`,
          payload: { disagreements: result.disagreements },
        });
        actions.push("review task");
      }
    }
    if ((await deps.repo.ensureHandoff(enquiry.id, note)) === "created") actions.push("handoff queued");
    flags.add("sync_pending");
  } else if (enquiry.outcome === "NOT_QUALIFIED") {
    flags.add("sync_pending");
    if (flags.has("nurture")) {
      const { values } = await deps.settings();
      await deps.repo.updateEnquiry(enquiry.id, { nurtureDueAt: addDays(now, 7 * Number(values.nurture_after_weeks ?? 6)) });
      actions.push("nurture date set");
    }
  } else if (enquiry.outcome === "NEEDS_HUMAN") {
    if (!(await deps.repo.hasOpenTask(enquiry.id, "callback"))) {
      const { rules } = await deps.settings();
      const promise = describeCallback(now, rules.office, rules.callbackWithinMin, rules.afterHoursCallbackTime);
      await deps.repo.createTask({ enquiryId: enquiry.id, kind: "callback", reason: "Caller needs a person", payload: { call_id: call.id }, dueAt: promise.at });
      actions.push("callback task");
    }
    flags.add("sync_pending");
  }
  const next = [...flags];
  if (next.length !== enquiry.flags.length) await deps.repo.updateEnquiry(enquiry.id, { flags: next });
}
