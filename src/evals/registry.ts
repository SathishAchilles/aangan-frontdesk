import type { Budget } from "./budget";
import type { EvalReport } from "./types";
import { buildReport } from "./report";
import { dataIntegrity } from "./runners/data-integrity";

export type EvalContext = {
  budget: Budget;
  args: Record<string, string | boolean>;
};

export type EvalRunner = (context: EvalContext) => Promise<EvalReport>;

// Proves the harness end to end: writes a passing report with zero cost.
const noop: EvalRunner = async ({ budget }) =>
  buildReport({
    evalName: "noop",
    datasetVersion: "none",
    startedAt: new Date(),
    metrics: { items: 0 },
    thresholds: [{ metric: "items", op: "==", value: 0 }],
    items: [],
    costInr: budget.spentInr,
  });

export const EVALS: Record<string, EvalRunner> = {
  noop,
  "data-integrity": dataIntegrity,
};
