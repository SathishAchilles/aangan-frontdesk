import { describe, expect, it } from "vitest";
import { containsPriceFigure } from "../../../src/evals/graders/deterministic";
import { fromIst } from "../../../src/lib/rules/time";
import { QUESTIONS } from "../../../src/lib/rules/wording";
import { evaluateEnquiry, logIntent, lookupCaller, mergeFacts } from "../../../src/lib/tools/handlers";
import { fakeDeps } from "./fake-repo";

const OPEN = fromIst(2026, 10, 13, 14, 0); // Tuesday afternoon
const NIGHT = fromIst(2026, 10, 13, 22, 47);
const PHONE = "+91 80562 03528";

const QUALIFIED_FACTS = {
  project_type: "residential",
  execution: "yes",
  scope_text: "Redo the whole 3BHK",
  full_home: true,
  sqft: 1400,
  locality: "Kothrud",
  deadline_text: "done by March",
  decision_text: "I'm the owner",
};

describe("lookup_caller", () => {
  it("returns IST time and office status with no caller for an unknown number", async () => {
    const response = await lookupCaller({ phone: PHONE }, fakeDeps(OPEN));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      now_ist: "2026-10-13T14:00+05:30",
      office_open: true,
      caller: null,
      open_enquiry: null,
    });
  });

  it("asks for a number when caller ID is missing", async () => {
    const response = await lookupCaller({}, fakeDeps(NIGHT));
    expect(response.body).toMatchObject({ office_open: false, next_office_open: "2026-10-14T10:00+05:30" });
    expect(response.body.ask_for_number).toMatch(/number/);
  });

  it("returns the recent enquiry and its known facts for a repeat caller", async () => {
    const deps = fakeDeps(OPEN);
    await evaluateEnquiry({ phone: PHONE, facts: { locality: "Viman Nagar", scope_text: "3BHK" } }, deps);
    const response = await lookupCaller({ phone: PHONE }, deps);
    const enquiry = response.body.open_enquiry as { known_facts: Record<string, unknown> };
    expect(response.body.caller).toMatchObject({ phone_masked: "+91 ••••• •3528" });
    expect(enquiry.known_facts).toMatchObject({ locality: "Viman Nagar" });
  });

  it("does not return enquiries older than 30 days", async () => {
    const deps = fakeDeps(OPEN);
    await evaluateEnquiry({ phone: PHONE, facts: {} }, deps);
    deps.repo.state.enquiries[0].createdAt = fromIst(2026, 9, 1, 10, 0);
    const response = await lookupCaller({ phone: PHONE }, deps);
    expect(response.body.open_enquiry).toBeNull();
  });
});

describe("evaluate_enquiry", () => {
  it("returns PENDING with the C1 question for an empty enquiry", async () => {
    const response = await evaluateEnquiry({ phone: PHONE, facts: {} }, fakeDeps(OPEN));
    expect(response.body).toMatchObject({ outcome: "PENDING", next_question: QUESTIONS.C1, asking: "C1" });
  });

  it("records the question as asked so it is not repeated", async () => {
    const deps = fakeDeps(OPEN);
    const first = await evaluateEnquiry({ phone: PHONE, facts: {} }, deps);
    const second = await evaluateEnquiry({ phone: PHONE, enquiry_id: first.body.enquiry_id, facts: {} }, deps);
    expect(second.body.next_question).toBe(QUESTIONS.C2);
  });

  it("returns QUALIFIED with a consultation type", async () => {
    const response = await evaluateEnquiry({ phone: PHONE, facts: QUALIFIED_FACTS }, fakeDeps(OPEN));
    expect(response.body).toMatchObject({ outcome: "QUALIFIED", consult_type: "studio" });
  });

  it("returns QUALIFIED_WITH_NOTES when the decision-maker is unclear", async () => {
    const response = await evaluateEnquiry(
      { phone: PHONE, facts: { ...QUALIFIED_FACTS, decision_text: "checking for my parents" } },
      fakeDeps(OPEN),
    );
    expect(response.body.outcome).toBe("QUALIFIED_WITH_NOTES");
  });

  it("returns NOT_QUALIFIED with a spoken close and no figures", async () => {
    const response = await evaluateEnquiry(
      { phone: PHONE, facts: { ...QUALIFIED_FACTS, rooms: ["kitchen", "bedroom"], full_home: false, budget_text: "1.5 lakh max" } },
      fakeDeps(OPEN),
    );
    expect(response.body.outcome).toBe("NOT_QUALIFIED");
    expect(containsPriceFigure(String(response.body.say_line))).toBe(false);
  });

  it("returns NEEDS_HUMAN with a callback time after hours", async () => {
    const deps = fakeDeps(NIGHT);
    const response = await evaluateEnquiry({ phone: PHONE, facts: { ...QUALIFIED_FACTS, wants_human: true } }, deps);
    expect(response.body).toMatchObject({ outcome: "NEEDS_HUMAN", callback_at: "2026-10-14T10:30+05:30" });
    expect(response.body.say_line).toMatch(/by 10:30 tomorrow morning/);
  });

  it("merges facts across turns of the same enquiry", async () => {
    const deps = fakeDeps(OPEN);
    const first = await evaluateEnquiry({ phone: PHONE, facts: { locality: "Kothrud" } }, deps);
    await evaluateEnquiry({ phone: PHONE, enquiry_id: first.body.enquiry_id, facts: { sqft: 1400 } }, deps);
    expect(deps.repo.state.enquiries[0].facts).toMatchObject({ locality: "Kothrud", sqft: 1400 });
    expect(deps.repo.state.enquiries[0].settingsVersion).toBe(7);
  });

  it("ignores an enquiry id that belongs to another caller", async () => {
    const deps = fakeDeps(OPEN);
    const other = await evaluateEnquiry({ phone: "+919800000001", facts: {} }, deps);
    const mine = await evaluateEnquiry({ phone: PHONE, enquiry_id: other.body.enquiry_id, facts: {} }, deps);
    expect(mine.body.enquiry_id).not.toBe(other.body.enquiry_id);
  });

  it("asks for the number when neither a phone nor an enquiry is given", async () => {
    const response = await evaluateEnquiry({ facts: {} }, fakeDeps(OPEN));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ outcome: "PENDING", asking: "phone" });
    expect(response.body.next_question).toMatch(/number/);
  });

  it("accepts fact fields at the top level, as Vaani sends them", async () => {
    const response = await evaluateEnquiry({ phone: PHONE, ...QUALIFIED_FACTS }, fakeDeps(OPEN));
    expect(response.body).toMatchObject({ outcome: "QUALIFIED", consult_type: "studio" });
  });

  it("continues an enquiry by id when the phone is left out", async () => {
    const deps = fakeDeps(OPEN);
    const first = await evaluateEnquiry({ phone: PHONE, project_type: "residential", execution: "yes", scope_text: "Redo the whole 3BHK" }, deps);
    const second = await evaluateEnquiry({ enquiry_id: first.body.enquiry_id, ...QUALIFIED_FACTS }, deps);
    expect(second.body).toMatchObject({ enquiry_id: first.body.enquiry_id, outcome: "QUALIFIED" });
  });

  it("rejects an unusable phone by asking for the number", async () => {
    const response = await evaluateEnquiry({ phone: "12", facts: {} }, fakeDeps(OPEN));
    expect(response.status).toBe(400);
    expect(response.body.say_line).toMatch(/number/);
  });
});

describe("log_intent", () => {
  it("creates an urgent task for an existing client with a senior callback promise", async () => {
    const deps = fakeDeps(OPEN);
    const response = await logIntent({ phone: PHONE, intent: "existing_client", summary: "Designer Aryan not replying for 5 days" }, deps);
    expect(response.body.say_line).toMatch(/within 15 minutes/);
    expect(deps.repo.state.tasks[0]).toMatchObject({ kind: "urgent" });
  });

  it("creates a message task otherwise", async () => {
    const deps = fakeDeps(OPEN);
    await logIntent({ phone: PHONE, intent: "message", summary: "Tile supplier wants a meeting" }, deps);
    expect(deps.repo.state.tasks[0]).toMatchObject({ kind: "message" });
  });

  it("rejects an unknown intent", async () => {
    expect((await logIntent({ intent: "sales", summary: "x" }, fakeDeps(OPEN))).status).toBe(400);
  });
});

describe("mergeFacts", () => {
  it("never erases a stored fact with an empty value", () => {
    expect(mergeFacts({ locality: "Baner", sqft: 900 }, { locality: "", sqft: undefined, rooms: [] })).toEqual({
      locality: "Baner",
      sqft: 900,
    });
  });
});
