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
