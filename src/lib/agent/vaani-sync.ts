// Pushes the agent defined in code (prompt, greeting, tools) to Vaani. Formats come from
// docs/vaani-spike.md. Idempotent: it finds the agent by name, creates it only if missing, keeps
// Vaani's tool ids, and sends the full tool list on every run.
import { createHash } from "node:crypto";
import { GREETING, TOOL, TOOL_SPECS } from "./spec";

export const AGENT_NAME = "Aangan Front Desk";
export const VAANI_API = "https://api.vaanivoice.ai";
// Vaani's built-in transfer tool has a fixed id across agents.
export const TRANSFER_TOOL_ID = "ed476e99-3f7c-40c4-8d17-68c5deacc2a5";
export const MAX_CALL_MINUTES = 15;
const LLM = { provider: "google", model: "gemini-3.5-flash", parameters: { temperature: 0.3, top_p: 1, max_tokens: 2000 } };

export type SyncInput = { prompt: string; appUrl: string; toolSecret: string; frontDeskPhone: string; gitSha?: string };

type VaaniFunction = {
  id?: string;
  function_name: string;
  description: string;
  function_params: unknown;
  is_custom: boolean;
  agent_config: { is_enabled: boolean; params: Record<string, unknown> };
};

// Python type names, as Vaani writes them when it parses a cURL ("phone (str): ...").
const PY_TYPE: Record<string, string> = { string: "str", number: "float", integer: "int", boolean: "bool", object: "dict" };

// Vaani builds the signature the model sees from an "Args:" docstring at the end of the description
// (the dashboard writes it this way); function_params alone leaves the model calling tools with {}.
// Parameters not in `required` are marked optional (Google docstring style); without it the model
// treats every parameter as required and invents values, e.g. a carpet area the caller never gave.
export function describeWithArgs(
  description: string,
  properties: Record<string, { type: string; description: string; enum?: string[]; items?: { type: string } }>,
  required: string[] = [],
): string {
  const lines = Object.entries(properties).map(([name, spec]) => {
    const base = spec.type === "array" ? `list[${PY_TYPE[spec.items?.type ?? "string"] ?? "str"}]` : (PY_TYPE[spec.type] ?? "str");
    const type = required.includes(name) ? base : `${base}, optional`;
    const options = spec.enum ? ` One of: ${spec.enum.join(", ")}.` : "";
    return `    ${name} (${type}): ${spec.description}${options}`;
  });
  return lines.length ? `${description}\n\nArgs:\n${lines.join("\n")}` : description;
}

export function promptVersion(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 12);
}

// The full function list for the agent. Existing ids are reused so Vaani does not register new ones.
export function buildFunctions(input: SyncInput, existing: { function_name?: string; id?: string }[] = []): VaaniFunction[] {
  const idOf = new Map(existing.filter((f) => f.function_name && f.id).map((f) => [f.function_name!, f.id!]));
  const custom = TOOL_SPECS.filter((spec) => spec.path).map((spec) => {
    const id = idOf.get(spec.name);
    return {
      ...(id ? { id } : {}),
      function_name: spec.name,
      description: describeWithArgs(spec.description, spec.parameters.properties, spec.parameters.required),
      function_params: { type: "object", properties: spec.parameters.properties, required: spec.parameters.required ?? [] },
      is_custom: true,
      agent_config: {
        is_enabled: true,
        params: {
          api_endpoint: `${input.appUrl.replace(/\/$/, "")}/api/vaani/tools/${spec.path}`,
          method: "POST",
          timeout_ms: 3000,
          headers: { "X-Tool-Key": input.toolSecret },
          query_params: {},
          store_variables: {},
        },
      },
    };
  });
  const transfer = TOOL_SPECS.find((spec) => spec.name === TOOL.transferCall)!;
  return [
    ...custom,
    {
      id: TRANSFER_TOOL_ID,
      function_name: TOOL.transferCall,
      description: transfer.description,
      function_params: {},
      is_custom: false,
      agent_config: {
        is_enabled: true,
        params: {
          prompt: transfer.description,
          phone_number: input.frontDeskPhone,
          announcement: ["One moment, I'm connecting you to our front desk."],
        },
      },
    },
  ];
}

export function buildPersona(input: SyncInput, existing: { function_name?: string; id?: string }[] = []) {
  return {
    identity: {
      system_prompt: input.prompt,
      // Not interruptible: the AI and recording disclosure must be heard in full.
      greeting_message: { agent_message: GREETING, agent_speech_delay: 1, interruptible: false, let_user_speak_first: false, user_speech_delay: 0 },
    },
    // Gemini only. Vaani keeps its own (disabled) default as the fallback; we never set one.
    senses_capabilities: { language: "en", auto_detect: false, brain: { llm: { primary: LLM, auto_detect: false } } },
    actions: { functions: buildFunctions(input, existing) },
    metadata: { prompt_version: promptVersion(input.prompt), source: "aangan-frontdesk", ...(input.gitSha ? { git_sha: input.gitSha } : {}) },
  };
}

export function buildExperience() {
  return {
    settings: {
      call_settings: {
        max_call_duration: MAX_CALL_MINUTES,
        max_duration_enabled: true,
        max_duration_action: "hang_up",
        max_duration_hangup_message: "I'm sorry, we've reached the time limit for this call. Someone from our team will call you back. Goodbye.",
      },
    },
  };
}

export type SyncResult = { agentId: string; created: boolean; promptVersion: string; functions: string[]; transferPhone: string | null };

export async function syncAgent(input: SyncInput, deps: { apiKey: string; fetch: typeof fetch }): Promise<SyncResult> {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await deps.fetch(`${VAANI_API}${path}`, {
      method,
      headers: { "X-API-Key": deps.apiKey, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Vaani ${method} ${path} -> ${response.status}: ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  };

  const listed = await call<{ data?: Record<string, unknown>[] } | Record<string, unknown>[]>("GET", `/api/agents?search=${encodeURIComponent(AGENT_NAME)}&page_size=50`);
  const rows = Array.isArray(listed) ? listed : (listed.data ?? []);
  const match = rows.find((row) => (row.agent_display_name ?? row.display_name) === AGENT_NAME);
  let agentId = match ? String(match.id ?? match.agent_id) : null;
  const created = !agentId;
  if (!agentId) {
    const made = await call<{ agent_id: string }>("POST", "/api/create-agent", { agent_display_name: AGENT_NAME, config: { persona: { identity: { system_prompt: input.prompt } } } });
    agentId = made.agent_id;
  }

  const current = await call<{ persona?: { actions?: { functions?: { function_name?: string; id?: string }[] } } }>("GET", `/api/agent/${agentId}`);
  await call("PATCH", `/api/agent/${agentId}/persona`, buildPersona(input, current.persona?.actions?.functions ?? []));
  await call("PATCH", `/api/agent/${agentId}/experience`, buildExperience());

  // Read back and verify what Vaani stored.
  const after = await call<{
    persona: { identity: { system_prompt: string }; actions: { functions: { function_name: string; agent_config?: { params?: { phone_number?: string } } }[] } };
  }>("GET", `/api/agent/${agentId}`);
  const stored = after.persona.identity.system_prompt;
  if (promptVersion(stored) !== promptVersion(input.prompt)) throw new Error("Vaani stored a different prompt than the one sent");
  const functions = after.persona.actions.functions.map((f) => f.function_name);
  const missing = buildFunctions(input).map((f) => f.function_name).filter((name) => !functions.includes(name));
  if (missing.length) throw new Error(`Vaani is missing tools after sync: ${missing.join(", ")}`);
  const transferPhone = after.persona.actions.functions.find((f) => f.function_name === TOOL.transferCall)?.agent_config?.params?.phone_number ?? null;
  return { agentId, created, promptVersion: promptVersion(input.prompt), functions, transferPhone };
}
