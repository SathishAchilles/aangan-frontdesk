// Deterministic grading of one simulated call. Every hard-zero metric is decided here.
import { QUESTIONS } from "../../lib/rules/wording";
import { asksAboutBudget, containsPriceFigure, oneQuestionPerTurn } from "../graders/deterministic";
import type { Persona } from "../types";
import type { SimResult } from "./simulate";

export type CallGrade = {
  // Same routing: QUALIFIED and QUALIFIED_WITH_NOTES both book and hand off; the difference is
  // only whether the note flags something the caller did not volunteer (the agent never asks C4/C5).
  outcome_match: boolean;
  exact_outcome_match: boolean;
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

  const evaluations = result.tools.filter((call) => call.name === "evaluate_enquiry");
  const isNewEnquiry = persona.facts.intent === "new";
  if (isNewEnquiry && evaluations.length === 0 && !result.tools.some((call) => call.name === "transfer_call")) issues.push("never called evaluate_enquiry");
  if (!isNewEnquiry && !result.tools.some((call) => call.name === "log_intent")) issues.push("did not use log_intent");
  let outcomeSoFar: string | null = null;
  let offered = false;
  for (const call of result.tools) {
    if (call.name === "evaluate_enquiry" && typeof call.body.outcome === "string") outcomeSoFar = call.body.outcome;
    if (call.name === "get_slots") {
      if (!outcomeSoFar || !QUALIFYING.has(outcomeSoFar)) issues.push("get_slots before qualifying");
      offered = true;
    }
    if (call.name === "book_slot" && !offered) issues.push("book_slot without get_slots");
    if (call.status >= 400 && call.status !== 409) issues.push(`${call.name} returned ${call.status}`);
  }

  // Re-asking: the same gate question twice, or asking for a fact the tools already hold.
  let reasks = 0;
  for (const question of Object.values(QUESTIONS)) {
    const times = agentTurns.filter((turn) => turn.includes(question)).length;
    if (times > 1) reasks += times - 1;
  }

  const bookedLabel = result.tools.find((call) => call.name === "book_slot" && call.body.ok === true);
  let recap: boolean | null = null;
  if (bookedLabel) {
    const after = agentTurns.slice(-2).join(" ");
    recap = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(after);
  } else if (result.final_outcome === "NEEDS_HUMAN") {
    recap = /call you back|call back|get back to you/i.test(agentTurns.slice(-3).join(" "));
  }

  return {
    outcome_match:
      result.final_outcome === persona.expected_outcome ||
      (QUALIFYING.has(result.final_outcome ?? "") && QUALIFYING.has(persona.expected_outcome)),
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
