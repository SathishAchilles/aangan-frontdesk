// Runs the gold facts for every labelled enquiry through the gate. The gold labels are
// provisional until the founder confirms them; the gate-accuracy eval reports the same numbers.
import { describe, expect, it } from "vitest";
import { loadJsonl } from "../../evals/datasets";
import { goldEnquirySchema } from "../../evals/types";
import { defaultRulesConfig } from "./config";
import { evaluateEnquiry } from "./gate";

const config = defaultRulesConfig();
const phone = loadJsonl("phone-transcripts.jsonl", goldEnquirySchema);
const all = loadJsonl("enquiries-40.jsonl", goldEnquirySchema);

function finalOutcome(item: (typeof all)[number]) {
  // End-of-call view: every askable question has been asked once.
  return evaluateEnquiry({ facts: item.facts, asked: ["C1", "C2", "C3"], now: new Date(item.received_at), config }).outcome;
}

describe("gold datasets", () => {
  it("contain 20 phone calls and 40 enquiries, all provisional for now", () => {
    expect(phone).toHaveLength(20);
    expect(all).toHaveLength(40);
    expect([...phone, ...all].filter((item) => item.provenance.status === "provisional")).toHaveLength(60);
  });
});

describe("T01-T20 regression", () => {
  const gradable = phone.filter((item) => item.gradable);
  it.each(gradable.map((item) => [item.id, item] as const))("%s matches its gold outcome", (_id, item) => {
    expect(finalOutcome(item)).toBe(item.expected_outcome);
  });

  it("matches at least 18 of 19 gradable calls", () => {
    const matches = gradable.filter((item) => finalOutcome(item) === item.expected_outcome).length;
    expect(matches).toBeGreaterThanOrEqual(18);
  });
});

describe("never qualifies a gold NOT_QUALIFIED enquiry", () => {
  it.each(all.filter((item) => item.expected_outcome === "NOT_QUALIFIED").map((item) => [item.id, item] as const))(
    "%s",
    (_id, item) => {
      expect(["QUALIFIED", "QUALIFIED_WITH_NOTES"]).not.toContain(finalOutcome(item));
    },
  );
});
