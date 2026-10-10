// One simulated phone call: a caller model plays a persona; a stand-in agent model follows
// prompts/agent.md and calls the real tool handlers (in memory). Vaani's own model differs, so
// these results estimate quality; real calls are still required before a release.
import type { Content, GoogleGenAI } from "@google/genai";
import { bookSlot, getSlots } from "../../lib/booking/handlers";
import { GREETING, TOOL, TOOL_SPECS } from "../../lib/agent/spec";
import { defaultRulesConfig } from "../../lib/rules/config";
import { isOfficeOpen } from "../../lib/rules/office-time";
import { SETTING_DEFINITIONS } from "../../lib/settings/definitions";
import { evaluateEnquiry, logIntent, lookupCaller } from "../../lib/tools/handlers";
import type { Budget } from "../budget";
import type { Persona } from "../types";
import { SimStore, simCalendar } from "./memory";

export type ToolCallLog = { turn: number; name: string; args: Record<string, unknown>; status: number; body: Record<string, unknown> };
export type SimResult = {
  persona_id: string;
  transcript: { speaker: "agent" | "caller"; text: string }[];
  tools: ToolCallLog[];
  ended_by: "agent" | "caller" | "turn_limit";
  final_outcome: string | null;
};

const MAX_TURNS = 16;
const MAX_TOOL_ROUNDS = 6;

const CALLER_RULES = [
  "You are role-playing a person phoning an interior design studio. Stay in character.",
  "Reply in one or two short spoken sentences, like a real phone call. Do not narrate.",
  "Only share details when they fit the conversation or you are asked; do not volunteer everything at once unless your brief says so.",
  "If asked something your brief does not cover, give a short plausible answer or say you are not sure.",
  "When the assistant has said goodbye, or the call has clearly ended, reply with exactly: [HANGUP]",
].join("\n");

async function generate(
  ai: GoogleGenAI,
  budget: Budget,
  model: string,
  contents: Content[],
  config: Record<string, unknown>,
) {
  const response = await ai.models.generateContent({ model, contents, config: { temperature: 0.4, ...config } });
  budget.charge(model, response.usageMetadata?.promptTokenCount ?? 0, response.usageMetadata?.candidatesTokenCount ?? 0);
  return response;
}

export async function simulateCall(
  persona: Persona,
  options: { ai: GoogleGenAI; budget: Budget; agentPrompt: string; agentModel: string; callerModel: string; callerId: string },
): Promise<SimResult> {
  const now = new Date(persona.call_at);
  const rules = defaultRulesConfig();
  const values = {
    ...Object.fromEntries(SETTING_DEFINITIONS.map((definition) => [definition.key, definition.default])),
    calcom_event_types: { studio: 1, site: 2, principal: 3 },
  };
  const store = new SimStore();
  const toolDeps = { repo: store.toolRepo(), now: () => now, settings: async () => ({ rules, version: 1 }) };
  const bookingDeps = { repo: store.bookingRepo(), calendar: simCalendar(now), now: () => now, settings: async () => ({ rules, values }) };

  const transcript: SimResult["transcript"] = [{ speaker: "agent", text: GREETING }];
  const tools: ToolCallLog[] = [];
  let lastOutcome: string | null = null;
  let ended = false;

  async function runTool(name: string, args: Record<string, unknown>, turn: number) {
    let response: { status: number; body: Record<string, unknown> };
    if (name === TOOL.lookupCaller) response = await lookupCaller(args, toolDeps);
    else if (name === TOOL.evaluateEnquiry) {
      // Arguments go through exactly as Vaani sends them (fact fields at the top level).
      response = await evaluateEnquiry(args, toolDeps);
      if (typeof response.body.outcome === "string") lastOutcome = response.body.outcome;
    } else if (name === TOOL.getSlots) {
      response = await getSlots(args, bookingDeps);
      if (response.body.outcome === "NEEDS_HUMAN") lastOutcome = "NEEDS_HUMAN";
    } else if (name === TOOL.bookSlot) {
      response = await bookSlot(args, bookingDeps);
      if (response.body.outcome === "NEEDS_HUMAN") lastOutcome = "NEEDS_HUMAN";
    } else if (name === TOOL.logIntent) {
      response = await logIntent(args, toolDeps);
      lastOutcome = "NOT_ENQUIRY";
    } else if (name === TOOL.transferCall) {
      const open = isOfficeOpen(now, rules.office);
      response = open
        ? { status: 200, body: { ok: true, transferred: true } }
        : { status: 200, body: { ok: false, error: "office closed; no one to transfer to" } };
      if (open) {
        lastOutcome ??= "NEEDS_HUMAN";
        ended = true;
      }
    } else if (name === TOOL.endCall) {
      ended = true;
      response = { status: 200, body: { ok: true } };
    } else response = { status: 404, body: { ok: false, error: `unknown tool ${name}` } };
    tools.push({ turn, name, args, status: response.status, body: response.body });
    return response.body;
  }

  const functionDeclarations = TOOL_SPECS.map((spec) => ({ name: spec.name, description: spec.description, parametersJsonSchema: spec.parameters }));
  const agentSystem = `${options.agentPrompt}\n\n## Call context (from the phone system)\n- Caller ID: ${options.callerId}\n- The greeting has already been spoken: "${GREETING}"`;
  const agentContents: Content[] = [];
  const callerContents: Content[] = [{ role: "user", parts: [{ text: GREETING }] }, { role: "model", parts: [{ text: persona.opening_line }] }];
  let callerText = persona.opening_line;
  transcript.push({ speaker: "caller", text: callerText });
  let endedBy: SimResult["ended_by"] = "turn_limit";

  for (let turn = 1; turn <= MAX_TURNS; turn += 1) {
    agentContents.push({ role: "user", parts: [{ text: callerText }] });
    let agentText = "";
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const response = await generate(options.ai, options.budget, options.agentModel, agentContents, {
        systemInstruction: agentSystem,
        tools: [{ functionDeclarations }],
      });
      const content = response.candidates?.[0]?.content;
      if (content) agentContents.push(content);
      const calls = response.functionCalls ?? [];
      const text = (content?.parts ?? [])
        .map((part) => part.text ?? "")
        .join(" ")
        .trim();
      if (text) agentText = agentText ? `${agentText} ${text}` : text;
      if (calls.length === 0) break;
      const parts = [];
      for (const call of calls) {
        const result = await runTool(call.name ?? "", (call.args ?? {}) as Record<string, unknown>, turn);
        parts.push({ functionResponse: { name: call.name, id: call.id, response: result } });
      }
      agentContents.push({ role: "user", parts });
      if (ended) break;
    }
    if (agentText) transcript.push({ speaker: "agent", text: agentText });
    if (ended) {
      endedBy = "agent";
      break;
    }

    callerContents.push({ role: "user", parts: [{ text: agentText || "(silence)" }] });
    const reply = await generate(options.ai, options.budget, options.callerModel, callerContents, {
      systemInstruction: `${CALLER_RULES}\n\nYOUR BRIEF:\n${persona.brief}`,
    });
    callerText = reply.text?.trim() || "[HANGUP]";
    callerContents.push({ role: "model", parts: [{ text: callerText }] });
    if (callerText.includes("[HANGUP]")) {
      endedBy = "caller";
      break;
    }
    transcript.push({ speaker: "caller", text: callerText });
  }

  return { persona_id: persona.id, transcript, tools, ended_by: endedBy, final_outcome: lastOutcome };
}
