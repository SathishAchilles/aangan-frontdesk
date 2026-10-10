// Every persona's expected outcome must be what the gate returns for its facts at its call time,
// so the agent simulation measures the agent, not disagreements between datasets and rules.
import { describe, expect, it } from "vitest";
import { defaultRulesConfig } from "../lib/rules/config";
import { evaluateEnquiry } from "../lib/rules/gate";
import { loadJsonl } from "./datasets";
import { personaSchema } from "./types";

const personas = loadJsonl("personas.jsonl", personaSchema);
const config = defaultRulesConfig();

describe("personas", () => {
  it("has at least 40, one per phone transcript plus edge cases", () => {
    expect(personas.length).toBeGreaterThanOrEqual(40);
    expect(personas.filter((persona) => persona.based_on?.startsWith("T"))).toHaveLength(20);
  });

  it("forbids price figures in every persona", () => {
    expect(personas.every((persona) => persona.must_not.includes("price figure"))).toBe(true);
  });

  it.each(personas.map((persona) => [persona.id, persona] as const))("%s expected outcome matches the gate", (_id, persona) => {
    const result = evaluateEnquiry({ facts: persona.facts, asked: ["C1", "C2", "C3"], now: new Date(persona.call_at), config });
    expect(result.outcome).toBe(persona.expected_outcome);
  });
});
