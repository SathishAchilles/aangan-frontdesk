import { describe, expect, it } from "vitest";
import { containsPriceFigure } from "../../evals/graders/deterministic";
import { defaultRulesConfig } from "./config";
import type { Facts } from "./facts";
import { evaluateEnquiry, type GateResult } from "./gate";
import { fromIst } from "./time";
import { ALL_SAY_LINES, FAIL_LINES, MULTI_FAIL_LINE, QUESTIONS } from "./wording";

const config = defaultRulesConfig();
const NOW = fromIst(2026, 9, 8, 11, 0); // Tuesday, office open
const ALL_ASKED = ["C1", "C2", "C3"] as const;

// A caller who passes everything; tests change one thing at a time.
const GOOD: Facts = {
  intent: "new",
  project_type: "residential",
  execution: "yes",
  scope_text: "Redo the whole flat - kitchen, living room, both bedrooms",
  full_home: true,
  sqft: 1400,
  locality: "Kothrud",
  deadline_text: "done by March, no rush",
  decision_text: "Yes - myself and my husband. He knows we're calling and is happy to go ahead.",
};

function run(facts: Partial<Facts>, asked: readonly string[] = ALL_ASKED, now = NOW): GateResult {
  return evaluateEnquiry({ facts: { ...GOOD, ...facts } as Facts, asked: [...asked] as never, now, config });
}

const state = (result: GateResult, id: string) => result.criteria.find((criterion) => criterion.id === id)?.state;

describe("hard service exclusions", () => {
  it("fails a restaurant with the segment reason and line", () => {
    const result = run({ project_type: "commercial", segment: "restaurant", scope_text: "interiors for a restaurant in Koregaon Park", locality: "Koregaon Park" });
    expect(result.outcome).toBe("NOT_QUALIFIED");
    expect(result.fail_reasons).toEqual(["segment"]);
    expect(result.say_line).toBe(FAIL_LINES.segment);
  });

  it("fails a gym", () => {
    expect(run({ project_type: "commercial", segment: "gym", sqft: 2500 }).fail_reasons).toContain("segment");
  });

  it("does not mistake storage for a shop", () => {
    expect(run({ scope_text: "kitchen with more storage" }).outcome).toBe("QUALIFIED");
  });

  it("fails an office over 3,000 sq ft with the size reason", () => {
    const result = run({ project_type: "commercial", property_kind: "office", sqft: 4500, full_home: false });
    expect(result.outcome).toBe("NOT_QUALIFIED");
    expect(result.fail_reasons).toEqual(["too_large"]);
  });

  it("fails structural work", () => {
    expect(run({ work_type: "structural" }).fail_reasons).toEqual(["structural"]);
  });
});

describe("five criteria with evidence", () => {
  it("stores a state and evidence for every criterion", () => {
    const result = run({});
    expect(result.criteria.map((criterion) => criterion.id)).toEqual(["C1", "C2", "C3", "C4", "C5"]);
    expect(result.criteria.find((criterion) => criterion.id === "C2")?.evidence).toBe("Kothrud");
    expect(state(result, "C4")).toBe("not_mentioned");
  });
});

describe("C1 real project", () => {
  it("fails advice only", () => {
    const result = run({ execution: undefined, scope_text: "Just want suggestions on colours and furniture arrangement" , work_type: "advice_only"});
    expect(state(result, "C1")).toBe("fail");
  });

  it("detects advice-only wording without a structured field", () => {
    expect(state(run({ execution: undefined, scope_text: "can someone come and give us some ideas for our living room" }), "C1")).toBe("fail");
  });

  it("passes a single room with execution", () => {
    const result = run({ full_home: false, rooms: ["bedroom"], scope_text: "full bedroom redesign with execution", execution: undefined });
    expect(state(result, "C1")).toBe("pass");
  });
});

describe("C2 service area", () => {
  it("fails Talegaon", () => expect(state(run({ locality: "Talegaon Dabhade, near Pune" }), "C2")).toBe("fail"));
  it("is unclear for an unknown locality", () => expect(state(run({ locality: "near the old highway" }), "C2")).toBe("unclear"));
});

describe("C3 timeline from today", () => {
  it("fails three weeks", () => expect(state(run({ deadline_text: "in 3 weeks" }), "C3")).toBe("fail"));

  it("passes eight weeks with a tight flag", () => {
    const result = run({ deadline_text: "in 8 weeks" });
    expect(state(result, "C3")).toBe("pass");
    expect(result.flags).toContain("tight_timeline");
  });

  it("resolves a festival from the date table", () => {
    // 1 October to Diwali (8 November 2026) is about 5 weeks: a fail.
    const result = run({ deadline_text: "before Diwali" }, ALL_ASKED, fromIst(2026, 10, 1, 11));
    expect(state(result, "C3")).toBe("fail");
    expect(result.criteria.find((criterion) => criterion.id === "C3")?.reason).toMatch(/5 weeks/);
  });

  it("never fails a distant start", () => {
    expect(state(run({ deadline_text: "Planning to move out temporarily for execution - starting February 2027" }), "C3")).toBe("pass");
  });
});

describe("C4 budget only when volunteered", () => {
  it("fails Rs 1.5 lakh for a kitchen and one bedroom, with no figure in the line", () => {
    const result = run({ full_home: false, rooms: ["kitchen", "bedroom"], sqft: 550, budget_text: "1 to 1.5 lakh maximum for everything", locality: "Kharadi" });
    expect(state(result, "C4")).toBe("fail");
    expect(result.say_line).toBe(FAIL_LINES.C4);
    expect(containsPriceFigure(result.say_line!)).toBe(false);
  });

  it("passes Rs 40 lakh for 1,950 sq ft", () => {
    expect(state(run({ sqft: 1950, budget_text: "₹35–40 lakh for the above scope" }), "C4")).toBe("pass");
  });

  it("treats an unmentioned budget as qualified", () => {
    expect(run({ budget_text: undefined }).outcome).toBe("QUALIFIED");
  });

  it("is unclear when the scope is too vague to judge", () => {
    expect(state(run({ sqft: undefined, full_home: undefined, rooms: undefined, scope_text: "interiors", budget_text: "10 lakh" }), "C4")).toBe("unclear");
  });
});

describe("C5 decision-maker", () => {
  it("is unclear, not failed, when calling for parents", () => {
    const result = run({ decision_text: "I'm doing the initial checking for my parents; they'll decide and will come to the consultation" });
    expect(state(result, "C5")).toBe("unclear");
    expect(result.outcome).toBe("QUALIFIED_WITH_NOTES");
  });
});

describe("gate outcomes", () => {
  it("lets a fail beat an unclear and asks nothing", () => {
    const result = run({ locality: "Nashik", deadline_text: undefined }, []);
    expect(result.outcome).toBe("NOT_QUALIFIED");
    expect(result.next_question).toBeUndefined();
  });

  it("returns QUALIFIED_WITH_NOTES when only the decision-maker is unclear", () => {
    expect(run({ decision_text: undefined }).outcome).toBe("QUALIFIED_WITH_NOTES");
  });

  it("asks one question at a time in order C1, C2, C3", () => {
    const facts = { execution: undefined, scope_text: undefined, locality: undefined, deadline_text: undefined };
    expect(run(facts, []).next_question).toBe(QUESTIONS.C1);
    expect(run(facts, ["C1"]).next_question).toBe(QUESTIONS.C2);
    expect(run(facts, ["C1", "C2"]).next_question).toBe(QUESTIONS.C3);
    expect(run(facts, []).outcome).toBe("PENDING");
  });

  it("does not ask about C4 or C5", () => {
    const result = run({ decision_text: undefined, budget_text: undefined }, []);
    expect(result.next_question).toBeUndefined();
  });
});

describe("still unclear after one question", () => {
  it("sends an unclear area to a person without a consult type", () => {
    const result = run({ locality: "I'm not sure" }, ALL_ASKED);
    expect(result.outcome).toBe("NEEDS_HUMAN");
    expect(result.consult_type).toBeUndefined();
    expect(result.say_line).toMatch(/call you back within 30 minutes/);
  });

  it("books an unclear timeline with a note", () => {
    const result = run({ deadline_text: undefined }, ALL_ASKED);
    expect(result.outcome).toBe("QUALIFIED_WITH_NOTES");
    expect(result.flags).toContain("unclear_C3");
  });

  it("promises a next-morning callback after hours", () => {
    const night = fromIst(2026, 9, 9, 22, 47);
    expect(run({ locality: "unknown place" }, ALL_ASKED, night).say_line).toMatch(/by 10:30 tomorrow morning/);
  });
});

describe("small commercial spaces", () => {
  it("sends a 180 sq ft pod to a person", () => {
    const result = run({ project_type: "commercial", property_kind: "office", sqft: 180, full_home: false, scope_text: "a 180 sq ft pod with lighting, a desk and storage" });
    expect(result.outcome).toBe("NEEDS_HUMAN");
    expect(result.flags).toContain("small_commercial");
  });

  it("declines it when the admin sets the action to decline", () => {
    const result = evaluateEnquiry({
      facts: { ...GOOD, project_type: "commercial", property_kind: "office", sqft: 180, full_home: false },
      asked: [...ALL_ASKED],
      now: NOW,
      config: { ...config, commercialBelowMinAction: "decline" },
    });
    expect(result.fail_reasons).toEqual(["too_small"]);
  });
});

describe("closing gracefully", () => {
  it("offers a later start and marks nurture when only the timeline failed", () => {
    const result = run({ deadline_text: "before Diwali, which is about three weeks away" });
    expect(result.say_line).toBe(FAIL_LINES.C3);
    expect(result.flags).toContain("nurture");
  });

  it("uses the general line for two or more fails", () => {
    const result = run({ locality: "Nashik", deadline_text: "in 2 weeks" });
    expect(result.say_line).toBe(MULTI_FAIL_LINE);
    expect(result.flags).not.toContain("nurture");
  });
});

describe("intent and requests for a person", () => {
  it("routes an existing client to a senior callback", () => {
    const result = run({ intent: "existing" });
    expect(result.outcome).toBe("NOT_ENQUIRY");
    expect(result.say_line).toMatch(/someone senior will call you back within 15 minutes/);
  });

  it("takes a message from anyone else", () => {
    expect(run({ intent: "other" }).outcome).toBe("NOT_ENQUIRY");
  });

  it("hands over when the caller asks for a person", () => {
    expect(run({ wants_human: true }).outcome).toBe("NEEDS_HUMAN");
  });
});

describe("consultation type", () => {
  it("offers a principal visit for a villa", () => {
    expect(run({ property_kind: "villa", sqft: 5500 }).consult_type).toBe("principal");
  });
  it("offers a site visit when asked", () => {
    expect(run({ wants_site_visit: true }).consult_type).toBe("site");
  });
  it("defaults to a studio consultation", () => {
    expect(run({}).consult_type).toBe("studio");
  });
});

describe("wording", () => {
  it("never contains a price figure", () => {
    for (const line of ALL_SAY_LINES) expect(containsPriceFigure(line), line).toBe(false);
  });
});
