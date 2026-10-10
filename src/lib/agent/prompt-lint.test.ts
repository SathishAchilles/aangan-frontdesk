// The agent prompt is part of the product: these checks run on every push.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { containsPriceFigure } from "../../evals/graders/deterministic";
import { PRICE_LINE } from "../rules/wording";
import { GREETING, TOOL_SPECS } from "./spec";

const prompt = readFileSync(join(process.cwd(), "prompts", "agent.md"), "utf8");
const note = readFileSync(join(process.cwd(), "prompts", "note.md"), "utf8");

describe("agent prompt", () => {
  it("contains the approved price line word for word", () => expect(prompt).toContain(PRICE_LINE));
  it("names every tool", () => {
    for (const tool of TOOL_SPECS) expect(prompt, tool.name).toContain(`\`${tool.name}\``);
  });
  it("contains no price figure", () => {
    for (const line of prompt.split("\n")) expect(containsPriceFigure(line), line).toBe(false);
  });
  it("forbids asking about budget and sending messages", () => {
    expect(prompt).toMatch(/Never ask about budget/);
    expect(prompt).toMatch(/Never send or promise any message, link, email or WhatsApp/);
  });
});

// Same structure as the studio's existing Vaani agent prompt ("Lead Qualification").
const SECTIONS = [
  "# 1. AGENT IDENTITY, LINGUISTIC RULES & CORE OBJECTIVES",
  "# 2. DYNAMIC VARIABLES & CONTEXT",
  "# 3. THE HUMAN IMPERFECTION PROTOCOL (CRITICAL)",
  "# 4. TTS PROSODY, SONIC SCRIPTING & CONSTRAINTS",
  "# 5. GUARDRAILS, KNOWLEDGE BASE & ESCALATION",
  "# 6. ADAPTIVE STATE-MACHINE (CALL FLOW)",
  "# 7. OBJECTION HANDLING PIVOTS",
];

describe("agent prompt format", () => {
  it("has the seven sections in order", () => {
    const positions = SECTIONS.map((heading) => prompt.indexOf(heading));
    expect(positions.every((position) => position >= 0), SECTIONS.filter((_, i) => positions[i] < 0).join(", ")).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
  it("starts the call flow at STATE 0 with the exact greeting", () => {
    expect(prompt).toContain("STATE 0: The Pre-Recorded Greeting");
    expect(prompt).toContain(GREETING);
  });
  it("keeps verbatim lines free of fillers", () => expect(prompt).toContain("The Verbatim Exception (CRITICAL)"));
  it("uses no digits outside headings", () => {
    const lines = prompt.split("\n").filter((line) => !/^# \d\.|^(STATE|STEP) \d|STEP \d/.test(line));
    expect(lines.filter((line) => /\d/.test(line))).toEqual([]);
  });
});

describe("greeting", () => {
  it("discloses the AI and the recording", () => {
    expect(GREETING).toMatch(/AI assistant/);
    expect(GREETING).toMatch(/recorded/);
  });
});

describe("note prompt", () => {
  it("forbids price figures and guessing", () => {
    expect(note).toMatch(/Never write any price/);
    expect(note).toMatch(/Never guess/);
  });
});
