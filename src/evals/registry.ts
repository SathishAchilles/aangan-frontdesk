import type { Budget } from "./budget";
import type { EvalReport } from "./types";
import { buildReport } from "./report";
import { agentSim } from "./runners/agent-sim";
import { dataIntegrity } from "./runners/data-integrity";
import { gateAccuracy } from "./runners/gate-accuracy";
import { metricReconcile } from "./runners/metric-reconcile";
import { idempotency } from "./runners/idempotency";
import { noteAccuracy } from "./runners/note-accuracy";
import { piiScan } from "./runners/pii-scan";
import { replayCorrectness } from "./runners/replay-correctness";
import { slotCompliance } from "./runners/slot-compliance";
import { toolLatency, toolLeakage } from "./runners/tools";
import { weekSimulation } from "./runners/week-simulation";

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
  "gate-accuracy": gateAccuracy,
  "tool-latency": toolLatency,
  "tool-leakage": toolLeakage,
  "slot-compliance": slotCompliance,
  "agent-sim": agentSim,
  "note-accuracy": noteAccuracy,
  idempotency,
  "week-simulation": weekSimulation,
  "metric-reconcile": metricReconcile,
  "replay-correctness": replayCorrectness,
  "pii-scan": piiScan,
};
