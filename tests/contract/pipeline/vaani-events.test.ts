import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { disagreements } from "../../../src/lib/note";
import {
  agentLines,
  type CallRow,
  type LinkedEnquiry,
  type PipelineDeps,
  type PipelineRepo,
  processVaaniEvent,
  safetyFlags,
  vaaniEventSchema,
  vaaniExternalId,
} from "../../../src/lib/pipeline/vaani-events";
import { defaultRulesConfig } from "../../../src/lib/rules/config";
import { fromIst } from "../../../src/lib/rules/time";
import type { TaskInput } from "../../../src/lib/tools/types";

const NOW = fromIst(2026, 10, 13, 14, 10);
const ROOM = "room_123abc";
const TRANSCRIPT = [
  "[14:01:02] AGENT: Hello, thank you for calling Aangan Studio. I'm the studio's AI assistant, and this call is recorded. How can I help you today?",
  "[14:01:09] USER: I want my 3BHK in Kothrud redone.",
  "[14:01:15] AGENT: That sounds lovely. When would you need the project complete?",
  "[14:01:20] USER: By March.",
].join("\n\n");

function setup(enquiry: Partial<LinkedEnquiry> | null = { outcome: "QUALIFIED" }) {
  const callsByRoom = new Map<string, CallRow & Record<string, unknown>>();
  const state = { costs: [] as { kind: string; qty: number; unitPriceInr: number }[], tasks: [] as TaskInput[], handoffs: new Map<string, unknown>(), enquiryPatches: [] as unknown[] };
  const linked: LinkedEnquiry | null = enquiry
    ? { id: "enq-1", outcome: "QUALIFIED", flags: [], facts: {}, criteria: [{ id: "C2", state: "pass", reason: "", evidence: "" }], consultType: "studio", ...enquiry }
    : null;
  const repo: PipelineRepo = {
    async upsertCall(id, patch) {
      const row = callsByRoom.get(id) ?? { id: randomUUID(), vaaniCallId: id, callerId: null, enquiryId: null, startedAt: null, durationS: null };
      Object.assign(row, Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)));
      callsByRoom.set(id, row);
      return row;
    },
    async upsertCaller() {
      return "caller-1";
    },
    async findEnquiryForCall() {
      return linked;
    },
    async hasCostLines(_callId, kind) {
      return state.costs.some((cost) => cost.kind === kind);
    },
    async addCostLine(line) {
      state.costs.push(line);
    },
    async hasOpenTask(_enquiryId, kind) {
      return state.tasks.some((task) => task.kind === kind);
    },
    async createTask(task) {
      state.tasks.push(task);
      return { id: randomUUID() };
    },
    async ensureHandoff(id, note) {
      if (state.handoffs.has(id)) return "exists";
      state.handoffs.set(id, note);
      return "created";
    },
    async handoffHasNote(id) {
      return Boolean(state.handoffs.get(id));
    },
    async updateEnquiry(_id, patch) {
      state.enquiryPatches.push(patch);
    },
  };
  const values = { merge_window_minutes: 60, cost_agent_inr_per_min: 4.92, cost_telephony_inr_per_min: 0, cost_ai_usd_per_m: { input: 0.75, output: 3.75 }, inr_per_usd: 88, nurture_after_weeks: 6 };
  const deps: PipelineDeps = {
    repo,
    now: () => NOW,
    settings: async () => ({ rules: defaultRulesConfig(), values }),
    writeNote: async () => ({ note: { one_line_summary: "3BHK in Kothrud", criteria: { C2: "pass" } }, disagreements: [], inputTokens: 1200, outputTokens: 300 }),
  };
  return { deps, state, callsByRoom };
}

const ev = (payload: unknown) => vaaniEventSchema.parse(payload);

// Every real call starts with call_started, which links the caller (and so the enquiry).
async function started(deps: PipelineDeps) {
  await processVaaniEvent(ev({ event: "call_started", room_name: ROOM, status: "dialing", phone_number: "+918056203528" }), deps);
}

describe("Vaani event processing", () => {
  it("links the caller on call_started", async () => {
    const { deps, callsByRoom } = setup();
    await processVaaniEvent(ev({ event: "call_started", room_name: ROOM, status: "dialing", phone_number: "+918056203528" }), deps);
    expect(callsByRoom.get(ROOM)).toMatchObject({ callerId: "caller-1", direction: "in" });
  });

  it("records rounded-up minutes once, using seconds from call_ended", async () => {
    const { deps, state } = setup();
    await started(deps);
    const ended = ev({ event: "call_ended", room_name: ROOM, call_duration: 125.4, end_reason: "AGENT_REQUESTED_DISCONNECT" });
    await processVaaniEvent(ended, deps);
    await processVaaniEvent(ended, deps);
    expect(state.costs.filter((cost) => cost.kind === "agent_min")).toEqual([{ callId: expect.any(String), enquiryId: "enq-1", kind: "agent_min", qty: 3, unitPriceInr: 4.92 }]);
  });

  it("marks a call that ended before an outcome as dropped", async () => {
    const { deps, callsByRoom } = setup({ outcome: "PENDING" });
    await started(deps);
    await processVaaniEvent(ev({ event: "call_ended", room_name: ROOM, call_duration: 70 }), deps);
    expect(callsByRoom.get(ROOM)?.dropped).toBe(true);
  });

  it("stores the transcript, queues the handoff once and records note token cost", async () => {
    const { deps, state, callsByRoom } = setup();
    await started(deps);
    const post = ev({ event: "call_postprocessing", call_id: ROOM, data: { room_name: ROOM, call_duration: 55150.02, transcript: TRANSCRIPT, summary: "3BHK", recording_url: "https://example.com/r" } });
    await processVaaniEvent(post, deps);
    await processVaaniEvent(post, deps);
    expect(callsByRoom.get(ROOM)).toMatchObject({ transcript: TRANSCRIPT, durationS: 55 });
    expect(state.handoffs.size).toBe(1);
    expect(state.costs.filter((cost) => cost.kind === "ai_in_tok")).toHaveLength(1);
    expect(state.tasks.filter((task) => task.kind === "alert")).toHaveLength(0);
  });

  it("raises a founder alert when the agent said a price figure", async () => {
    const { deps, state } = setup();
    await started(deps);
    const leaked = `${TRANSCRIPT}\n\n[14:02:00] AGENT: It usually costs about Rs 1,800 per sq ft.`;
    await processVaaniEvent(ev({ event: "call_postprocessing", call_id: ROOM, data: { transcript: leaked } }), deps);
    expect(state.tasks.find((task) => task.kind === "alert")?.payload).toMatchObject({ notify: ["founder"] });
  });

  it("creates a review task when the note disagrees, without changing the outcome", async () => {
    const { deps, state } = setup();
    await started(deps);
    deps.writeNote = async () => ({ note: { criteria: { C2: "fail" } }, disagreements: ["C2"], inputTokens: 1, outputTokens: 1 });
    await processVaaniEvent(ev({ event: "call_postprocessing", call_id: ROOM, data: { transcript: TRANSCRIPT } }), deps);
    expect(state.tasks.find((task) => task.kind === "review")?.reason).toMatch(/C2/);
    expect(state.handoffs.size).toBe(1);
  });

  it("creates one callback task for a NEEDS_HUMAN enquiry", async () => {
    const { deps, state } = setup({ outcome: "NEEDS_HUMAN" });
    await started(deps);
    const post = ev({ event: "call_postprocessing", call_id: ROOM, data: { transcript: TRANSCRIPT } });
    await processVaaniEvent(post, deps);
    await processVaaniEvent(post, deps);
    expect(state.tasks.filter((task) => task.kind === "callback")).toHaveLength(1);
  });

  it("sets a nurture date for a timeline-only fail", async () => {
    const { deps, state } = setup({ outcome: "NOT_QUALIFIED", flags: ["nurture"] });
    await started(deps);
    await processVaaniEvent(ev({ event: "call_postprocessing", call_id: ROOM, data: { transcript: TRANSCRIPT } }), deps);
    expect(state.enquiryPatches).toContainEqual({ nurtureDueAt: fromIst(2026, 11, 24, 14, 10) });
  });

  it("creates a callback task when a transfer fails", async () => {
    const { deps, state } = setup();
    await started(deps);
    await processVaaniEvent(ev({ event: "human_transfer_failed", room_name: ROOM, transfer_type: "warm", phone_number: "+918056203528", reason: "busy" }), deps);
    expect(state.tasks[0]).toMatchObject({ kind: "callback", reason: expect.stringMatching(/busy/) });
  });

  it("gives a redelivered event the same external id", () => {
    const a = ev({ event: "call_ended", room_name: ROOM, call_duration: 10 });
    expect(vaaniExternalId(a)).toBe("call_ended:room_123abc");
    expect(vaaniExternalId(ev({ event: "call_postprocessing", call_id: ROOM, data: {} }))).toBe("call_postprocessing:room_123abc");
  });
});

describe("transcript helpers", () => {
  it("extracts agent lines from Vaani's transcript format", () => {
    expect(agentLines(TRANSCRIPT)).toHaveLength(2);
    expect(safetyFlags(TRANSCRIPT)).toEqual({ price_figure: [], budget_question: [] });
  });

  it("treats only pass-versus-fail as a disagreement", () => {
    const live = [
      { id: "C1", state: "pass", reason: "", evidence: "" },
      { id: "C2", state: "pass", reason: "", evidence: "" },
      { id: "C5", state: "unclear", reason: "", evidence: "" },
    ] as const;
    expect(disagreements([...live], { C1: "unclear", C2: "fail", C5: "pass" })).toEqual(["C2"]);
  });
});
