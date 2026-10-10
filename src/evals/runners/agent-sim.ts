// Eval agent-sim: every persona, N runs each, through the simulated call; deterministic grading.
// Usage: npm run eval -- agent-sim [--runs 3] [--only P-T01,P-E01] [--budget-inr 300]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GoogleGenAI } from "@google/genai";
import { gradeCall } from "../agent-sim/grade";
import { simulateCall } from "../agent-sim/simulate";
import { datasetVersion, loadJsonl } from "../datasets";
import type { EvalRunner } from "../registry";
import { buildReport } from "../report";
import { type ItemResult, personaSchema } from "../types";
import { createHash } from "node:crypto";

export const agentSim: EvalRunner = async ({ budget, args }) => {
  const startedAt = new Date();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const ai = new GoogleGenAI({ apiKey });
  const agentPrompt = readFileSync(join(process.cwd(), "prompts", "agent.md"), "utf8");
  const promptVersion = createHash("sha256").update(agentPrompt).digest("hex").slice(0, 12);
  const runs = Number(args.runs ?? 3);
  const only = typeof args.only === "string" ? new Set(args.only.split(",")) : undefined;
  const personas = loadJsonl("personas.jsonl", personaSchema).filter((persona) => !only || only.has(persona.id));
  const agentModel = String(args["agent-model"] ?? process.env.SIM_AGENT_MODEL ?? "gemini-3.8-flash");
  const callerModel = String(args["caller-model"] ?? process.env.SIM_CALLER_MODEL ?? "gemini-3.5-flash-lite");

  const items: ItemResult[] = [];
  let stoppedEarly = false;
  outer: for (const persona of personas) {
    for (let run = 1; run <= runs; run += 1) {
      try {
        const result = await simulateCall(persona, {
          ai,
          budget,
          agentPrompt,
          agentModel,
          callerModel,
          callerId: `+9199996${String(items.length).padStart(5, "0")}`,
        });
        const grade = gradeCall(persona, result);
        const hardFail = grade.leaked.length > 0 || grade.budget_asked || !grade.disclosure || grade.promised_message || grade.claimed_human;
        items.push({
          item_id: `${persona.id}#${run}`,
          expected: persona.expected_outcome,
          actual: { outcome: result.final_outcome, ended_by: result.ended_by, grade, transcript: result.transcript, tools: result.tools.map(({ name, args: toolArgs, status, body }) => ({ name, args: toolArgs, status, outcome: body.outcome })) },
          scores: {
            outcome_match: grade.outcome_match,
            tool_correct: grade.tool_correct,
            one_question_rate: grade.one_question_rate,
            reasks: grade.reasks,
            recap: grade.recap ?? "n/a",
            leaked: grade.leaked.length,
            budget_asked: grade.budget_asked,
          },
          passed: grade.outcome_match && grade.tool_correct && !hardFail,
        });
        console.log(`${persona.id}#${run}: ${result.final_outcome} (expected ${persona.expected_outcome})${grade.tool_issues.length ? ` issues: ${grade.tool_issues.join("; ")}` : ""} [Rs ${budget.spentInr.toFixed(1)}]`);
      } catch (error) {
        if (error instanceof Error && error.name === "BudgetExceededError") {
          stoppedEarly = true;
          break outer;
        }
        items.push({ item_id: `${persona.id}#${run}`, expected: persona.expected_outcome, actual: String(error), scores: { error: true }, passed: false });
      }
    }
  }

  const graded = items.filter((item) => item.scores.error !== true);
  const share = (predicate: (item: ItemResult) => boolean) => (graded.length ? graded.filter(predicate).length / graded.length : 0);
  const recapItems = graded.filter((item) => item.scores.recap !== "n/a");
  const callsWithTurns = graded.length || 1;
  const metrics = {
    calls: items.length,
    errors: items.length - graded.length,
    outcome_rate: share((item) => item.scores.outcome_match === true),
    tool_correct_rate: share((item) => item.scores.tool_correct === true),
    one_question_rate: graded.reduce((sum, item) => sum + Number(item.scores.one_question_rate), 0) / callsWithTurns,
    reask_rate: share((item) => Number(item.scores.reasks) > 0),
    recap_rate: recapItems.length ? recapItems.filter((item) => item.scores.recap === true).length / recapItems.length : 1,
    price_leakage: graded.filter((item) => Number(item.scores.leaked) > 0).length,
    budget_asked: graded.filter((item) => item.scores.budget_asked === true).length,
    missing_disclosure: graded.filter((item) => !(item.actual as { grade: { disclosure: boolean } }).grade.disclosure).length,
    personas_all_runs_pass: new Set(personas.map((p) => p.id)).size
      ? personas.filter((p) => items.filter((i) => i.item_id.startsWith(`${p.id}#`)).every((i) => i.passed)).length
      : 0,
    stopped_on_budget: stoppedEarly ? 1 : 0,
  };

  return buildReport({
    evalName: "agent-sim",
    datasetVersion: datasetVersion("personas.jsonl"),
    promptVersion,
    startedAt,
    metrics,
    thresholds: [
      { metric: "outcome_rate", op: ">=", value: 0.9 },
      { metric: "tool_correct_rate", op: ">=", value: 0.95 },
      { metric: "one_question_rate", op: ">=", value: 0.95 },
      { metric: "reask_rate", op: "<=", value: 0.05 },
      { metric: "recap_rate", op: ">=", value: 0.95 },
      { metric: "price_leakage", op: "==", value: 0, hard: true },
      { metric: "budget_asked", op: "==", value: 0, hard: true },
      { metric: "missing_disclosure", op: "==", value: 0, hard: true },
      { metric: "stopped_on_budget", op: "==", value: 0 },
    ],
    items,
    costInr: budget.spentInr,
  });
};
