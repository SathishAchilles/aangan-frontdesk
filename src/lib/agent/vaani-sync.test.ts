import { describe, expect, it } from "vitest";
import { TOOL, TOOL_SPECS } from "./spec";
import { AGENT_NAME, buildFunctions, buildPersona, MAX_CALL_MINUTES, promptVersion, type SyncInput, syncAgent, TRANSFER_TOOL_ID } from "./vaani-sync";

const INPUT: SyncInput = { prompt: "# 1. AGENT IDENTITY\nYou are the studio's AI assistant.", appUrl: "https://aangan-frontdesk.vercel.app/", toolSecret: "tool-secret-value", frontDeskPhone: "+918056203528" };

type Fn = { function_name: string; id?: string; function_id?: string };
type FakeAgent = {
  agent_display_name: string;
  persona: { identity: { system_prompt?: string }; actions: { functions: Fn[] } };
  experience: { settings?: { call_settings?: { max_call_duration?: number } } };
};
type Body = {
  agent_display_name: string;
  config: { persona: { identity: { system_prompt: string } } };
  identity: { system_prompt: string };
  actions: { functions: Fn[] };
} & FakeAgent["experience"];

// An in-memory Vaani that behaves like the real API: PATCH replaces the function list and assigns ids.
function fakeVaani(options: { existing?: boolean; corruptPrompt?: boolean } = {}) {
  const agents = new Map<string, FakeAgent>();
  if (options.existing) agents.set("agent-1", { agent_display_name: AGENT_NAME, persona: { identity: {}, actions: { functions: [] } }, experience: {} });
  agents.set("agent-riya", { agent_display_name: "Lead Qualification", persona: { identity: { system_prompt: "Riya" }, actions: { functions: [] } }, experience: {} });
  const calls: { method: string; path: string; body?: Body }[] = [];
  let created = 0;
  const fetcher = (async (url: string, init: RequestInit) => {
    const path = url.replace("https://api.vaanivoice.ai", "");
    const body = (init.body ? JSON.parse(String(init.body)) : undefined) as Body;
    calls.push({ method: String(init.method), path, body });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (path.startsWith("/api/agents?")) return json({ data: [...agents].map(([id, a]) => ({ id, agent_display_name: a.agent_display_name })) });
    if (path === "/api/create-agent") {
      created += 1;
      const id = `agent-new-${created}`;
      agents.set(id, { agent_display_name: body.agent_display_name, persona: { identity: { system_prompt: body.config.persona.identity.system_prompt }, actions: { functions: [] } }, experience: {} });
      return json({ agent_id: id });
    }
    const match = path.match(/^\/api\/agent\/([^/]+)(\/persona|\/experience)?$/);
    const agent = match && agents.get(match[1]);
    if (!agent) return json({ detail: "Not Found" }, 404);
    if (init.method === "GET") return json({ agent_display_name: agent.agent_display_name, persona: agent.persona });
    if (match![2] === "/experience") {
      agent.experience = body;
      return json({});
    }
    const functions = body.actions.functions.map((f) => ({ ...f, id: f.id ?? `fn-${f.function_name}`, function_id: f.id ?? `fn-${f.function_name}` }));
    agent.persona = { ...agent.persona, ...body, identity: { ...body.identity, system_prompt: options.corruptPrompt ? "changed" : body.identity.system_prompt }, actions: { functions } };
    return json({});
  }) as unknown as typeof fetch;
  return { fetcher, agents, calls };
}

describe("buildFunctions", () => {
  const functions = buildFunctions(INPUT);
  it("includes every tool with an endpoint, plus the transfer tool", () => {
    const expected = [...TOOL_SPECS.filter((spec) => spec.path).map((spec) => spec.name), TOOL.transferCall];
    expect(functions.map((f) => f.function_name)).toEqual(expected);
  });
  it("points each custom tool at its endpoint with the tool key and a short timeout", () => {
    const lookup = functions.find((f) => f.function_name === TOOL.lookupCaller)!;
    expect(lookup.agent_config.params).toMatchObject({
      api_endpoint: "https://aangan-frontdesk.vercel.app/api/vaani/tools/lookup-caller",
      method: "POST",
      headers: { "X-Tool-Key": "tool-secret-value" },
    });
    expect(Number(lookup.agent_config.params.timeout_ms)).toBeLessThanOrEqual(3000);
  });
  it("sends transfers to the front desk", () => {
    const transfer = functions.find((f) => f.function_name === TOOL.transferCall)!;
    expect(transfer).toMatchObject({ id: TRANSFER_TOOL_ID, is_custom: false, agent_config: { is_enabled: true, params: { phone_number: "+918056203528" } } });
  });
  it("reuses Vaani's ids for tools that already exist", () => {
    const again = buildFunctions(INPUT, [{ function_name: TOOL.evaluateEnquiry, id: "kept-id" }]);
    expect(again.find((f) => f.function_name === TOOL.evaluateEnquiry)?.id).toBe("kept-id");
    expect(again.find((f) => f.function_name === TOOL.getSlots)?.id).toBeUndefined();
  });
});

describe("buildPersona", () => {
  const persona = buildPersona(INPUT);
  it("uses Gemini only and never sets a fallback", () => {
    expect(persona.senses_capabilities.brain.llm.primary.provider).toBe("google");
    expect(JSON.stringify(persona)).not.toMatch(/fallback|openai|azure/);
  });
  it("plays the disclosure greeting without interruption", () => {
    expect(persona.identity.greeting_message.agent_message).toMatch(/AI assistant.*recorded/);
    expect(persona.identity.greeting_message.interruptible).toBe(false);
  });
  it("tags the prompt version", () => expect(persona.metadata.prompt_version).toBe(promptVersion(INPUT.prompt)));
});

describe("syncAgent", () => {
  it("creates the agent on the first run and updates the same agent on the second", async () => {
    const vaani = fakeVaani();
    const first = await syncAgent(INPUT, { apiKey: "k", fetch: vaani.fetcher });
    expect(first).toMatchObject({ created: true, agentId: "agent-new-1", transferPhone: "+918056203528" });
    const idsAfterFirst = vaani.agents.get("agent-new-1")!.persona.actions.functions.map((f) => f.id);

    const second = await syncAgent(INPUT, { apiKey: "k", fetch: vaani.fetcher });
    expect(second).toMatchObject({ created: false, agentId: "agent-new-1" });
    expect(vaani.agents.get("agent-new-1")!.persona.actions.functions.map((f) => f.id)).toEqual(idsAfterFirst);
    expect([...vaani.agents.values()].filter((a) => a.agent_display_name === AGENT_NAME)).toHaveLength(1);
  });

  it("sets the maximum call length and never touches other agents", async () => {
    const vaani = fakeVaani({ existing: true });
    await syncAgent(INPUT, { apiKey: "k", fetch: vaani.fetcher });
    expect(vaani.agents.get("agent-1")!.experience.settings?.call_settings?.max_call_duration).toBe(MAX_CALL_MINUTES);
    expect(vaani.calls.filter((c) => c.path.includes("agent-riya"))).toEqual([]);
    expect(vaani.agents.get("agent-riya")!.persona.identity.system_prompt).toBe("Riya");
  });

  it("fails if Vaani stored a different prompt", async () => {
    await expect(syncAgent(INPUT, { apiKey: "k", fetch: fakeVaani({ existing: true, corruptPrompt: true }).fetcher })).rejects.toThrow(/different prompt/);
  });
});
