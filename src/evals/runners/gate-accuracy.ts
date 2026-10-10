// Eval gate-accuracy: gold facts for every labelled enquiry through the gate, as of the time each
// enquiry arrived. Reports agreement, a confusion matrix, false qualifications and price leakage.
import { defaultRulesConfig } from "../../lib/rules/config";
import { evaluateEnquiry } from "../../lib/rules/gate";
import { datasetVersion, loadJsonl } from "../datasets";
import { containsPriceFigure } from "../graders/deterministic";
import type { EvalRunner } from "../registry";
import { buildReport } from "../report";
import { goldEnquirySchema, type ItemResult, OUTCOMES } from "../types";

const FILES = ["phone-transcripts.jsonl", "enquiries-40.jsonl"];
const QUALIFYING = new Set(["QUALIFIED", "QUALIFIED_WITH_NOTES"]);

export const gateAccuracy: EvalRunner = async ({ budget }) => {
  const startedAt = new Date();
  const config = defaultRulesConfig();
  // Phone calls appear in both files; grade each enquiry once.
  const byId = new Map(FILES.flatMap((file) => loadJsonl(file, goldEnquirySchema)).map((item) => [item.id, item]));
  const gold = [...byId.values()].filter((item) => item.gradable);

  const confusion: Record<string, Record<string, number>> = {};
  const items: ItemResult[] = gold.map((item) => {
    const result = evaluateEnquiry({ facts: item.facts, asked: ["C1", "C2", "C3"], now: new Date(item.received_at), config });
    const expected = item.expected_outcome!;
    const spoken = [result.say_line ?? "", result.next_question ?? ""];
    const leaked = spoken.some(containsPriceFigure);
    const falseQualified = expected === "NOT_QUALIFIED" && QUALIFYING.has(result.outcome);
    confusion[expected] ??= {};
    confusion[expected][result.outcome] = (confusion[expected][result.outcome] ?? 0) + 1;
    return {
      item_id: item.id,
      expected,
      actual: { outcome: result.outcome, fail_reasons: result.fail_reasons, flags: result.flags },
      scores: { match: result.outcome === expected, false_qualified: falseQualified, leaked },
      passed: result.outcome === expected && !falseQualified && !leaked,
    };
  });

  const total = items.length;
  const matches = items.filter((item) => item.scores.match === true).length;
  const metrics: Record<string, number> = {
    items: total,
    agreement: total ? matches / total : 0,
    false_qualified: items.filter((item) => item.scores.false_qualified === true).length,
    price_leakage: items.filter((item) => item.scores.leaked === true).length,
    provisional_labels: gold.filter((item) => item.provenance.status === "provisional").length,
  };
  for (const expected of OUTCOMES) {
    for (const actual of [...OUTCOMES, "PENDING"]) {
      const count = confusion[expected]?.[actual];
      if (count) metrics[`confusion.${expected}->${actual}`] = count;
    }
  }

  return buildReport({
    evalName: "gate-accuracy",
    datasetVersion: datasetVersion(...FILES),
    startedAt,
    metrics,
    thresholds: [
      { metric: "agreement", op: ">=", value: 0.9 },
      { metric: "false_qualified", op: "==", value: 0, hard: true },
      { metric: "price_leakage", op: "==", value: 0, hard: true },
    ],
    items,
    costInr: budget.spentInr,
  });
};
