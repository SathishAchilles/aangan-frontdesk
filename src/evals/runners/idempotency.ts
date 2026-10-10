// Eval idempotency: replays a set of Vaani call events three times through the pipeline (in memory)
// and counts duplicated side effects: cost lines, tasks, handoffs, note generations.
import { randomUUID } from "node:crypto";
import { type CallRow, type LinkedEnquiry, type PipelineRepo, processVaaniEvent, vaaniEventSchema } from "../../lib/pipeline/vaani-events";
import { defaultRulesConfig } from "../../lib/rules/config";
import { SETTING_DEFINITIONS } from "../../lib/settings/definitions";
import type { EvalRunner } from "../registry";
import { buildReport } from "../report";
import type { ItemResult } from "../types";

const OUTCOMES: LinkedEnquiry["outcome"][] = ["QUALIFIED", "QUALIFIED_WITH_NOTES", "NOT_QUALIFIED", "NEEDS_HUMAN", "PENDING"];

function scenario(outcome: LinkedEnquiry["outcome"], index: number) {
  const room = `room-idem-${index}`;
  const transcript = `[10:00:00] AGENT: Hello, I'm the studio's AI assistant and this call is recorded.\n\n[10:00:05] USER: Hi.${index % 2 ? "\n\n[10:00:09] AGENT: That is about Rs 1,800 per sq ft." : ""}`;
  return {
    outcome,
    events: [
      { event: "call_started", room_name: room, phone_number: `+91999950000${index}` },
      { event: "call_ended", room_name: room, call_duration: 200 + index },
      { event: "call_postprocessing", call_id: room, data: { room_name: room, call_duration: (200 + index) * 1000, transcript } },
      { event: "human_transfer_failed", room_name: room, reason: "busy" },
    ],
  };
}

export const idempotency: EvalRunner = async ({ budget }) => {
  const startedAt = new Date();
  const values = Object.fromEntries(SETTING_DEFINITIONS.map((definition) => [definition.key, definition.default]));
  const items: ItemResult[] = [];
  let duplicates = 0;

  for (const [index, outcome] of OUTCOMES.entries()) {
    const counts = { costs: 0, tasks: 0, handoffs: 0, notes: 0 };
    const calls = new Map<string, CallRow & Record<string, unknown>>();
    const costKinds = new Set<string>();
    const openTasks: { enquiryId: string | null; kind: string; callId?: string }[] = [];
    const handoffs = new Map<string, unknown>();
    const enquiry: LinkedEnquiry = { id: `enq-${index}`, outcome, flags: outcome === "NOT_QUALIFIED" ? ["nurture"] : [], facts: {}, criteria: [], consultType: null };
    const repo: PipelineRepo = {
      async upsertCall(id, patch) {
        const row = calls.get(id) ?? { id: randomUUID(), vaaniCallId: id, callerId: null, enquiryId: null, startedAt: null, durationS: null };
        Object.assign(row, Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)));
        calls.set(id, row);
        return row;
      },
      upsertCaller: async () => "caller",
      findEnquiryForCall: async () => enquiry,
      hasCostLines: async (callId, kind) => costKinds.has(`${callId}:${kind}`),
      async addCostLine(line) {
        costKinds.add(`${line.callId}:${line.kind}`);
        counts.costs += 1;
      },
      hasOpenTask: async (enquiryId, kind, callId) =>
        openTasks.some((task) => task.kind === kind && (enquiryId === null || task.enquiryId === enquiryId) && (!callId || task.callId === callId)),
      async createTask(task) {
        openTasks.push({ enquiryId: task.enquiryId ?? null, kind: task.kind, callId: String((task.payload as { call_id?: string }).call_id ?? "") });
        counts.tasks += 1;
        return { id: randomUUID() };
      },
      async ensureHandoff(id, note) {
        if (handoffs.has(id)) return "exists";
        handoffs.set(id, note);
        counts.handoffs += 1;
        return "created";
      },
      handoffHasNote: async (id) => Boolean(handoffs.get(id)),
      async updateEnquiry(_id, patch) {
        if (patch.flags) enquiry.flags = patch.flags;
      },
    };
    const deps = {
      repo,
      now: () => new Date("2026-10-13T08:30:00Z"),
      settings: async () => ({ rules: defaultRulesConfig(), values }),
      writeNote: async () => {
        counts.notes += 1;
        return { note: { one_line_summary: "test" }, disagreements: [], inputTokens: 10, outputTokens: 5 };
      },
    };

    const { events } = scenario(outcome, index);
    for (let round = 0; round < 3; round += 1) {
      for (const event of events) await processVaaniEvent(vaaniEventSchema.parse(event), deps);
    }
    const once = { costs: counts.costs, tasks: counts.tasks, handoffs: counts.handoffs, notes: counts.notes };
    // A single delivery for comparison: replay into a fresh run would equal `once` if idempotent,
    // so any side effect counted more than its single-delivery maximum is a duplicate.
    const expectedMax = { costs: BOOKS.has(outcome) ? 4 : 2, handoffs: BOOKS.has(outcome) ? 1 : 0, notes: BOOKS.has(outcome) ? 1 : 0 };
    const extra = Math.max(0, once.costs - expectedMax.costs) + Math.max(0, once.handoffs - expectedMax.handoffs) + Math.max(0, once.notes - expectedMax.notes);
    const taskKinds = openTasks.map((task) => task.kind);
    const duplicateTasks = taskKinds.length - new Set(taskKinds).size;
    duplicates += extra + duplicateTasks;
    items.push({
      item_id: `${outcome}`,
      expected: expectedMax,
      actual: { ...once, task_kinds: taskKinds },
      scores: { duplicates: extra + duplicateTasks },
      passed: extra + duplicateTasks === 0,
    });
  }

  return buildReport({
    evalName: "idempotency",
    datasetVersion: "replay-x3-v1",
    startedAt,
    metrics: { scenarios: items.length, events_replayed: items.length * 4 * 3, duplicate_side_effects: duplicates },
    thresholds: [{ metric: "duplicate_side_effects", op: "==", value: 0, hard: true }],
    items,
    costInr: budget.spentInr,
  });
};

const BOOKS = new Set<LinkedEnquiry["outcome"]>(["QUALIFIED", "QUALIFIED_WITH_NOTES"]);
