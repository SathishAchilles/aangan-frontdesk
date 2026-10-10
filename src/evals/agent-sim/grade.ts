// Deterministic grading of one simulated call. Every hard-zero metric is decided here.
import { TOOL } from "../../lib/agent/spec";
import { QUESTIONS } from "../../lib/rules/wording";
import { asksAboutBudget, containsPriceFigure, oneQuestionPerTurn } from "../graders/deterministic";
import type { Persona } from "../types";
import type { SimResult } from "./simulate";

export type CallGrade = {
  // Same routing: QUALIFIED and QUALIFIED_WITH_NOTES both book and hand off; the difference is
  // only whether the note flags something the caller did not volunteer (the agent never asks C4/C5).
  outcome_match: boolean;
  exact_outcome_match: boolean;
  // The simulated caller asked for a person, so NEEDS_HUMAN is the correct routing whatever the persona expected.
  caller_requested_person: boolean;
  tool_correct: boolean;
  tool_issues: string[];
  one_question_rate: number;
  reasks: number;
  recap: boolean | null;
  leaked: string[];
  budget_asked: boolean;
  disclosure: boolean;
  promised_message: boolean;
  claimed_human: boolean;
};

const QUALIFYING = new Set(["QUALIFIED", "QUALIFIED_WITH_NOTES"]);
const MESSAGE_PROMISE = /\b(i(?:'ll| will) (?:send|share|whatsapp|email|text)|sending you (?:a|the)|on whatsapp)\b/i;

export function gradeCall(persona: Persona, result: SimResult): CallGrade {
  const agentTurns = result.transcript.filter((line) => line.speaker === "agent").map((line) => line.text);
  const issues: string[] = [];

  const evaluations = result.tools.filter((call) => call.name === TOOL.evaluateEnquiry);
  const isNewEnquiry = persona.facts.intent === "new";
  if (isNewEnquiry && evaluations.length === 0 && !result.tools.some((call) => call.name === TOOL.transferCall)) issues.push(`never called ${TOOL.evaluateEnquiry}`);
  if (!isNewEnquiry && !result.tools.some((call) => call.name === TOOL.logIntent)) issues.push(`did not use ${TOOL.logIntent}`);
  let outcomeSoFar: string | null = null;
  let offered = false;
  for (const call of result.tools) {
    if (call.name === TOOL.evaluateEnquiry && typeof call.body.outcome === "string") outcomeSoFar = call.body.outcome;
    if (call.name === TOOL.getSlots) {
      if (!outcomeSoFar || !QUALIFYING.has(outcomeSoFar)) issues.push(`${TOOL.getSlots} before qualifying`);
      offered = true;
    }
    if (call.name === TOOL.bookSlot && !offered) issues.push(`${TOOL.bookSlot} without ${TOOL.getSlots}`);
    if (call.status >= 400 && call.status !== 409) issues.push(`${call.name} returned ${call.status}`);
  }

  // Re-asking: the same gate question twice, or asking for a fact the tools already hold.
  let reasks = 0;
  for (const question of Object.values(QUESTIONS)) {
    const times = agentTurns.filter((turn) => turn.includes(question)).length;
    if (times > 1) reasks += times - 1;
  }

  const bookedLabel = result.tools.find((call) => call.name === TOOL.bookSlot && call.body.ok === true);
  let recap: boolean | null = null;
  if (bookedLabel) {
    const after = agentTurns.slice(-2).join(" ");
    recap = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(after);
  } else if (result.final_outcome === "NEEDS_HUMAN") {
    recap = /call you back|call back|get back to you/i.test(agentTurns.slice(-3).join(" "));
  }

  const callerRequestedPerson = result.tools.some((call) => call.name === TOOL.evaluateEnquiry && call.args.wants_human === true);
  return {
    caller_requested_person: callerRequestedPerson,
    outcome_match:
      result.final_outcome === persona.expected_outcome ||
      (QUALIFYING.has(result.final_outcome ?? "") && QUALIFYING.has(persona.expected_outcome)) ||
      (callerRequestedPerson && result.final_outcome === "NEEDS_HUMAN"),
    exact_outcome_match: result.final_outcome === persona.expected_outcome,
    tool_correct: issues.length === 0,
    tool_issues: issues,
    one_question_rate: oneQuestionPerTurn(agentTurns.slice(1)),
    reasks,
    recap,
    leaked: agentTurns.filter(containsPriceFigure),
    budget_asked: agentTurns.some(asksAboutBudget),
    disclosure: /\bAI assistant\b/.test(agentTurns[0] ?? "") && /recorded/.test(agentTurns[0] ?? ""),
    promised_message: agentTurns.some((turn) => MESSAGE_PROMISE.test(turn)),
    claimed_human: agentTurns.some((turn) => /\bI(?:'m| am) (?:a )?(?:real |human)(?: person)?\b/i.test(turn) && !/\bAI\b/.test(turn)),
  };
}
