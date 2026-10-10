// Builds the demo data set in memory: about six weeks of calls ending "now", busiest in the last few
// days. A pure function of its inputs (a fixed pseudo-random seed), so reruns produce the same shape.
// Every row is built in its final, inert state; see ./constants.ts for why each choice is safe.
import { randomUUID } from "node:crypto";
import { safetyFlags } from "../../src/lib/pipeline/vaani-events";
import { addOfficeMinutes, nextOfficeOpen, type OfficeConfig, officeMinutesBetween } from "../../src/lib/rules/office-time";
import { fromIst, istParts } from "../../src/lib/rules/time";
import { DEMO_EVAL_COMMIT, DEMO_EVAL_DATASET, DEMO_FIXED_COST_PREFIX, DEMO_ID_PREFIX, demoPhone, NUDGE_CAP } from "./constants";
import {
  callbackTurns,
  droppedTurns,
  existingClientTurns,
  messageTurns,
  needsHumanTurns,
  type NotQualifiedReason,
  notQualifiedTurns,
  type Persona,
  qualifiedTurns,
  renderTranscript,
  slipTurns,
  type Turn,
} from "./scripts";

export type Designer = { id: string; name: string; consultTypes: string[] };
export type DemoInputs = {
  now: Date;
  designers: Designer[];
  frontDeskId: string | null;
  office: OfficeConfig;
  prices: { agentPerMin: number; telephonyPerMin: number; aiInPerTok: number; aiOutPerTok: number };
  transcriptDays: number;
  acceptReminderMin: number;
  acceptEscalateMin: number;
};

type Consult = "studio" | "site" | "principal";
type Criterion = { id: string; state: "pass" | "fail" | "unclear" | "not_mentioned"; reason: string; evidence: string };

export type CallerRow = { id: string; phone_e164: string; name: string | null; first_seen_at: Date; last_seen_at: Date };
export type EnquiryRow = {
  id: string;
  caller_id: string;
  intent: "new" | "existing" | "other";
  outcome: string;
  criteria: Criterion[];
  flags: string[];
  facts: Record<string, unknown>;
  asked: string[];
  consult_type: Consult | null;
  assigned_designer_id: string | null;
  consult_result: "won" | "lost" | null;
  consult_result_at: Date | null;
  outcome_nudges: number;
  last_nudge_at: Date | null;
  created_at: Date;
  updated_at: Date;
};
export type CallRow = {
  id: string;
  vaani_call_id: string;
  enquiry_id: string | null;
  caller_id: string;
  direction: "in" | "out";
  started_at: Date;
  ended_at: Date;
  duration_s: number;
  transcript: string | null;
  summary: string | null;
  end_reason: string;
  dropped: boolean;
  callback_of_call_id: string | null;
  callback_placed_at: Date | null;
  prompt_version: string;
  grader_flags: { price_figure: string[]; budget_question: string[] };
  created_at: Date;
};
export type BookingRow = { id: string; enquiry_id: string; calcom_uid: string; consult_type: Consult; start_at: Date; end_at: Date; designer_id: string | null; status: "booked" | "rescheduled" | "cancelled"; created_at: Date; updated_at: Date };
export type HandoffRow = { id: string; enquiry_id: string; chat_id: number; message_id: number; note: Record<string, unknown>; posted_at: Date; accepted_by: string | null; accepted_at: Date | null; reminded_at: Date | null; escalated_at: Date | null };
export type TaskRow = { id: string; enquiry_id: string | null; kind: "callback" | "urgent" | "message" | "review" | "alert"; reason: string; payload: Record<string, unknown>; due_at: null; chat_id: number; message_id: number; done_at: Date; done_by: string | null; escalated_at: null; created_at: Date };
export type CostRow = { id: string; call_id: string; enquiry_id: string | null; kind: "agent_min" | "telephony_min" | "ai_in_tok" | "ai_out_tok"; qty: number; unit_price_inr: number; amount_inr: number; recorded_at: Date };
export type FixedCostRow = { month: string; item: string; amount_inr: number };
export type EvalRunRow = { id: string; eval_name: string; dataset_version: string; commit_sha: string; prompt_version: string; started_at: Date; finished_at: Date; metrics: Record<string, number>; thresholds: { metric: string; op: ">=" | "<=" | "=="; value: number; hard?: boolean }[]; failed_thresholds: string[]; passed: boolean; cost_inr: number };

export type DemoPlan = {
  callers: CallerRow[];
  enquiries: EnquiryRow[];
  calls: CallRow[];
  bookings: BookingRow[];
  handoffs: HandoffRow[];
  tasks: TaskRow[];
  cost_lines: CostRow[];
  fixed_costs: FixedCostRow[];
  eval_runs: EvalRunRow[];
};

// Demo rows never point at a real Telegram chat: 0 is not a valid chat id.
const NO_CHAT = 0;
const PROMPT_VERSION = "frontdesk-v7";
const MIN = 60_000;
const DAY = 86_400_000;

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Aarav", "Ananya", "Rohan", "Meera", "Kunal", "Sneha", "Vikram", "Pooja", "Siddharth", "Neha", "Aditya", "Ishita", "Varun", "Kavya", "Nikhil", "Shruti", "Harsh", "Tanvi", "Omkar", "Ritika", "Pranav", "Gauri", "Yash", "Aditi", "Sameer", "Rhea", "Amol", "Nandini", "Kedar", "Payal", "Tejas", "Mrunal", "Abhishek", "Sayali", "Chinmay", "Divya", "Rahul", "Anjali", "Saurabh", "Prachi"];
const LAST = ["Joshi", "Kulkarni", "Deshmukh", "Patil", "Gokhale", "Bhide", "Sathe", "Apte", "Kale", "Paranjpe", "Rao", "Iyer", "Menon", "Shah", "Mehta", "Bhosale", "Pawar", "Jadhav", "Shinde", "Ghatge", "Nair", "Chitale", "Phadke", "Karve", "Datar"];
const IN_AREA = ["Kothrud", "Baner", "Aundh", "Wakad", "Koregaon Park", "Kalyani Nagar", "Viman Nagar", "Hadapsar", "Magarpatta", "NIBM", "Kondhwa", "Undri", "Erandwane", "Deccan", "Kharadi", "Nanded City", "Warje"];
const OUT_AREA = ["Lonavala", "Nashik", "Talegaon", "Mumbai"];
const HOMES: { home: string; sqft: [number, number]; scope: string; kind: string }[] = [
  { home: "2BHK", sqft: [850, 1100], scope: "the whole flat, with a modular kitchen and wardrobes in both bedrooms", kind: "apartment" },
  { home: "3BHK", sqft: [1250, 1650], scope: "the full 3BHK, kitchen, wardrobes, false ceiling and the living room", kind: "apartment" },
  { home: "3BHK", sqft: [1300, 1550], scope: "a redo of the kitchen, the master bedroom and the living room", kind: "apartment" },
  { home: "4BHK", sqft: [2000, 2600], scope: "the entire 4BHK, end to end", kind: "apartment" },
  { home: "villa", sqft: [3200, 4200], scope: "the whole villa, interiors on all three floors", kind: "villa" },
  { home: "row house", sqft: [2200, 2800], scope: "a full redesign of the row house before we move in", kind: "independent_house" },
  { home: "office", sqft: [900, 1800], scope: "an office fit-out for about twenty people, workstations and two cabins", kind: "office" },
];
const DEADLINES = ["by March next year", "before Diwali next year", "in about four to five months", "no fixed date, we're flexible", "by the end of April", "within six months"];
const DECIDERS = ["My wife and I decide together", "I'm the owner, so it's my call", "My husband and I will both be at the meeting", "It's my flat, I decide"];
const STYLES = ["Something warm and minimal, lots of wood.", "Modern, but not too flashy. We like earthy colours.", "My wife likes a classic look with some traditional touches.", "Clean lines, white and grey, very easy to maintain."];
const REFERRALS = ["my colleague got her flat done by you in Baner", "we saw your work at a friend's home in Aundh"];
const ISSUES = ["the kitchen shutter has come off its hinge", "there's a crack in the new false ceiling", "the wardrobe delivery is a week late", "the painter left a mess on the balcony"];
const SLOT_TIMES: [number, number][] = [[11, 0], [12, 30], [15, 0], [16, 30], [17, 30]];

type Kind =
  | "qualified"
  | "notes_decider"
  | "notes_behalf"
  | "price_slip"
  | "budget_slip"
  | `nq_${NotQualifiedReason}`
  | "needs_human"
  | "existing"
  | "vendor"
  | "job"
  | "reschedule"
  | "dropped";

type Slot = { start: Date; afterHours: boolean };

const isOffice = (date: Date, office: OfficeConfig) => {
  const p = istParts(date);
  const minutes = p.hour * 60 + p.minute;
  const [sh, sm] = office.start.split(":").map(Number);
  const [eh, em] = office.end.split(":").map(Number);
  return office.days.includes(p.weekday) && minutes >= sh * 60 + sm && minutes < eh * 60 + em;
};

export function buildDemoPlan(input: DemoInputs): DemoPlan {
  const { now, office } = input;
  const random = rng(20261011);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
  const between = (lo: number, hi: number) => Math.round(lo + random() * (hi - lo));
  const today = istParts(now);
  const dayStart = (daysAgo: number) => fromIst(today.year, today.month, today.day - daysAgo, 0, 0);
  const at = (base: Date, hour: number, minute: number) => {
    const p = istParts(base);
    return fromIst(p.year, p.month, p.day, hour, minute);
  };

  // 1. Call slots: ~3 a weekday six weeks back, rising to 6-7 a day in the last five days.
  const slots: Slot[] = [];
  for (let daysAgo = 41; daysAgo >= 1; daysAgo -= 1) {
    const day = dayStart(daysAgo);
    const weekend = !office.days.includes(istParts(day).weekday);
    const count = weekend ? (daysAgo <= 5 ? 3 : 1) : daysAgo <= 5 ? 6 + (daysAgo % 2) : daysAgo <= 14 ? 4 : 3;
    for (let i = 0; i < count; i += 1) {
      const afterHours = weekend || random() < 0.22;
      const [hour, minute] = afterHours ? pick([[7, 40], [8, 55], [19, 20], [20, 5], [21, 35], [22, 10], [11, 15], [16, 40]] as const) : [between(10, 18), pick([0, 10, 20, 30, 40, 50])];
      slots.push({ start: at(day, hour, minute), afterHours: afterHours && !isOffice(at(day, hour, minute), office) });
    }
  }
  // Today: calls spread back from "now", the latest ending well before the job could look at it.
  for (const minutesAgo of [32, 58, 96, 141, 205, 262, 330]) {
    const start = new Date(now.getTime() - minutesAgo * MIN);
    if (start.getTime() >= dayStart(0).getTime()) slots.push({ start, afterHours: !isOffice(start, office) });
  }
  slots.sort((a, b) => a.start.getTime() - b.start.getTime());

  // 2. A story per slot. Every scenario appears at least once; the rest follow a realistic mix.
  const mix: [Kind, number][] = [
    ["qualified", 36],
    ["notes_decider", 9],
    ["notes_behalf", 7],
    ["nq_C1", 3],
    ["nq_C2", 4],
    ["nq_C3", 4],
    ["nq_C4", 3],
    ["nq_segment", 2],
    ["nq_structural", 1],
    ["nq_too_large", 1],
    ["needs_human", 6],
    ["existing", 5],
    ["vendor", 3],
    ["job", 2],
    ["reschedule", 2],
    ["dropped", 6],
  ];
  const totalWeight = mix.reduce((sum, [, weight]) => sum + weight, 0);
  const kinds: Kind[] = slots.map(() => {
    let roll = random() * totalWeight;
    for (const [kind, weight] of mix) {
      roll -= weight;
      if (roll < 0) return kind;
    }
    return "qualified";
  });
  const required: Kind[] = ["price_slip", "budget_slip", "nq_C1", "nq_C2", "nq_C3", "nq_C4", "nq_segment", "nq_structural", "nq_too_large", "needs_human", "existing", "vendor", "job", "dropped", "notes_decider", "notes_behalf"];
  required.forEach((kind, index) => {
    if (kind !== "price_slip" && kind !== "budget_slip" && kinds.includes(kind)) return;
    // Spread forced stories over the six weeks, replacing an ordinary qualified call and keeping
    // the last few slots (which hold today's and tomorrow's bookings) as they are.
    let target = 3 + index * Math.floor((slots.length - 10) / required.length);
    while (target < slots.length - 8 && kinds[target] !== "qualified") target += 1;
    if (target >= slots.length - 8) throw new Error(`No slot left for the ${kind} story`);
    kinds[target] = kind;
  });
  for (const kind of required) if (!kinds.includes(kind)) throw new Error(`Demo plan is missing the ${kind} story`);

  const plan: DemoPlan = { callers: [], enquiries: [], calls: [], bookings: [], handoffs: [], tasks: [], cost_lines: [], fixed_costs: [], eval_runs: [] };
  const designers = input.designers;
  const principalDesigners = designers.filter((d) => d.consultTypes.includes("principal"));
  let designerTurn = 0;
  const designerFor = (consult: Consult): Designer | null => {
    if (designers.length === 0) return null;
    if (consult === "principal" && principalDesigners.length > 0) return principalDesigners[designerTurn++ % principalDesigners.length];
    return designers[designerTurn++ % designers.length];
  };
  let messageId = 7_000;
  let callerNo = 0;
  const transcriptCutoff = now.getTime() - (input.transcriptDays - 2) * DAY;

  const newCaller = (first: string | null, last: string, start: Date): CallerRow => {
    callerNo += 1;
    const row = { id: randomUUID(), phone_e164: demoPhone(callerNo), name: first ? `${first} ${last} (demo)` : null, first_seen_at: start, last_seen_at: start };
    plan.callers.push(row);
    return row;
  };

  const addCall = (o: { caller: CallerRow; enquiryId: string | null; start: Date; seconds: number; turns: Turn[]; summary: string; dropped?: boolean; direction?: "in" | "out"; callbackOf?: string | null; cleanAgent?: boolean }): CallRow => {
    const ended = new Date(o.start.getTime() + o.seconds * 1000);
    const p = istParts(o.start);
    const keepText = o.start.getTime() > transcriptCutoff;
    const transcript = renderTranscript(o.turns, { hour: p.hour, minute: p.minute }, o.seconds);
    const flags = safetyFlags(transcript);
    if ((o.cleanAgent ?? true) && (flags.price_figure.length > 0 || flags.budget_question.length > 0)) {
      throw new Error(`Demo transcript would trip the safety check: ${[...flags.price_figure, ...flags.budget_question].join(" | ")}`);
    }
    const row: CallRow = {
      id: randomUUID(),
      vaani_call_id: `${DEMO_ID_PREFIX}${o.direction === "out" ? "outbound-" : ""}${String(plan.calls.length + 1).padStart(4, "0")}`,
      enquiry_id: o.enquiryId,
      caller_id: o.caller.id,
      direction: o.direction ?? "in",
      started_at: o.start,
      ended_at: ended,
      duration_s: o.seconds,
      transcript: keepText ? transcript : null,
      summary: keepText ? o.summary : null,
      end_reason: o.dropped ? "USER_HANGUP" : "AGENT_REQUESTED_DISCONNECT",
      dropped: o.dropped ?? false,
      callback_of_call_id: o.callbackOf ?? null,
      callback_placed_at: null,
      prompt_version: PROMPT_VERSION,
      grader_flags: flags,
      created_at: o.start,
    };
    plan.calls.push(row);
    if (o.caller.last_seen_at < o.start) o.caller.last_seen_at = o.start;
    const minutes = Math.max(1, Math.ceil(o.seconds / 60));
    addCost(row, o.enquiryId, "agent_min", minutes, input.prices.agentPerMin, ended);
    addCost(row, o.enquiryId, "telephony_min", minutes, input.prices.telephonyPerMin, ended);
    return row;
  };
  const addCost = (call: CallRow, enquiryId: string | null, kind: CostRow["kind"], qty: number, unit: number, at: Date) => {
    plan.cost_lines.push({ id: randomUUID(), call_id: call.id, enquiry_id: enquiryId, kind, qty, unit_price_inr: unit, amount_inr: Math.round(qty * unit * 10_000) / 10_000, recorded_at: at });
  };
  const addTask = (o: { enquiryId: string | null; kind: TaskRow["kind"]; reason: string; payload: Record<string, unknown>; created: Date; doneAfterMin: number }) => {
    const done = new Date(Math.min(o.created.getTime() + o.doneAfterMin * MIN, now.getTime() - MIN));
    plan.tasks.push({ id: randomUUID(), enquiry_id: o.enquiryId, kind: o.kind, reason: o.reason, payload: o.payload, due_at: null, chat_id: NO_CHAT, message_id: messageId++, done_at: done, done_by: input.frontDeskId, escalated_at: null, created_at: o.created });
  };
  const newEnquiry = (o: Partial<EnquiryRow> & Pick<EnquiryRow, "caller_id" | "outcome" | "created_at">): EnquiryRow => {
    const row: EnquiryRow = {
      id: randomUUID(),
      intent: "new",
      criteria: [],
      flags: [],
      facts: {},
      asked: [],
      consult_type: null,
      assigned_designer_id: null,
      consult_result: null,
      consult_result_at: null,
      outcome_nudges: 0,
      last_nudge_at: null,
      updated_at: o.created_at,
      ...o,
    };
    plan.enquiries.push(row);
    return row;
  };
  // Office-hours callback promise, worded the way the agent says it.
  const callbackWords = (start: Date) => (isOffice(start, office) ? "within the next half hour" : "tomorrow morning at 10:30");

  const firstCallers: { caller: CallerRow; first: string; last: string; kind: Kind }[] = [];
  const repeated = new Set<string>();
  const qualifiedStories: { enquiry: EnquiryRow; call: CallRow; consult: Consult; designer: Designer | null; booked: boolean }[] = [];

  slots.forEach((slot, index) => {
    const kind = kinds[index];
    const first = FIRST[(index * 7 + 3) % FIRST.length];
    const last = LAST[(index * 11 + 5) % LAST.length];
    const start = slot.start;
    const locality = pick(IN_AREA);

    // Repeat callers: a dropped caller rings back next day, an existing client calls a second time,
    // and a booked client calls to move the consultation.
    const repeatOf = (want: Kind) => firstCallers.find((c) => c.kind === want && !repeated.has(c.caller.id) && c.caller.last_seen_at.getTime() < start.getTime() - 6 * 3600_000);
    let caller: CallerRow;
    let callerFirst = first;
    const repeat = kind === "existing" ? repeatOf("existing") : kind === "reschedule" ? repeatOf("qualified") : kind === "qualified" && index % 4 === 1 ? repeatOf("dropped") : undefined;
    if (repeat) {
      caller = repeat.caller;
      callerFirst = repeat.first;
      repeated.add(caller.id);
      caller.name ??= `${callerFirst} ${repeat.last} (demo)`;
    } else caller = newCaller(kind === "dropped" && index % 3 === 0 ? null : first, last, start);
    const isRepeat = caller.first_seen_at.getTime() < start.getTime();

    if (kind === "qualified" || kind === "notes_decider" || kind === "notes_behalf" || kind === "price_slip" || kind === "budget_slip") {
      const home = pick(HOMES.filter((h) => h.kind !== "office" || kind === "qualified"));
      const sqft = Math.round(between(home.sqft[0], home.sqft[1]) / 10) * 10;
      const siteVisit = home.kind !== "villa" && random() < 0.35;
      const consult: Consult = home.kind === "villa" || home.kind === "independent_house" || sqft >= 3000 ? "principal" : siteVisit ? "site" : "studio";
      const notes = kind === "notes_decider" ? "decider" : kind === "notes_behalf" ? "behalf" : "none";
      const persona: Persona = {
        first: callerFirst,
        locality,
        home: home.home,
        sqft,
        scope: home.scope,
        deadline: pick(DEADLINES),
        decider: notes === "none" ? pick(DECIDERS) : null,
        style: random() < 0.6 ? pick(STYLES) : null,
        referral: random() < 0.15 ? pick(REFERRALS) : null,
        askedPrice: random() < 0.3,
        siteVisit,
        booked: qualifiedStories.length % 8 !== 5,
        consult,
      };
      const turns = kind === "price_slip" ? slipTurns(persona, "price") : kind === "budget_slip" ? slipTurns(persona, "budget") : qualifiedTurns(persona, notes);
      const outcome = notes === "none" ? "QUALIFIED" : "QUALIFIED_WITH_NOTES";
      const flags = [...(persona.referral ? ["referral"] : []), ...(notes === "none" ? [] : ["unclear_C5"])];
      const criteria: Criterion[] = [
        { id: "C1", state: "pass", reason: "design with execution", evidence: "Design and execution both." },
        { id: "C2", state: "pass", reason: `${locality} is in Pune city or PCMC`, evidence: locality },
        { id: "C3", state: "pass", reason: persona.deadline.includes("flexible") ? "no fixed deadline" : "about 20 weeks", evidence: persona.deadline },
        { id: "C4", state: "not_mentioned", reason: "budget not mentioned (counts as qualified)", evidence: "" },
        notes === "none"
          ? { id: "C5", state: "pass", reason: "caller decides or is authorised", evidence: persona.decider ?? "" }
          : notes === "behalf"
            ? { id: "C5", state: "unclear", reason: "caller is acting for someone else", evidence: "I'm calling for my parents, it's their flat. They'll decide." }
            : { id: "C5", state: "unclear", reason: "decision-maker unclear", evidence: "I'm not sure yet, we'll see." },
      ];
      const designer = designerFor(consult);
      const enquiry = newEnquiry({
        caller_id: caller.id,
        outcome,
        criteria,
        flags,
        facts: { intent: "new", project_type: home.kind === "office" ? "commercial" : "residential", execution: "yes", scope_text: home.scope, property_kind: home.kind, sqft, locality, deadline_text: persona.deadline, ...(persona.decider ? { decision_text: persona.decider } : {}), ...(persona.referral ? { referral_text: persona.referral } : {}), wants_site_visit: siteVisit },
        asked: ["C1", "C3"],
        consult_type: consult,
        assigned_designer_id: designer?.id ?? null,
        created_at: start,
      });
      const seconds = between(260, 520) + (persona.style ? 40 : 0);
      const slip = kind === "price_slip" || kind === "budget_slip";
      const call = addCall({
        caller,
        enquiryId: enquiry.id,
        start,
        seconds,
        turns,
        cleanAgent: !slip,
        summary: `${callerFirst} wants ${home.scope} for a ${home.home} of about ${sqft.toLocaleString("en-IN")} sq ft in ${locality}, ${persona.deadline}. ${outcome === "QUALIFIED" ? "Qualified" : "Qualified with notes (decision-maker unclear)"}; ${persona.booked ? `${consult} consultation booked` : `${consult} consultation offered; a designer will call to fix a time`}.${persona.askedPrice ? " Asked about cost; the agent explained pricing is discussed at the consultation." : ""}`,
      });
      // The post-call note (Gemini) cost.
      addCost(call, enquiry.id, "ai_in_tok", between(2600, 4800), input.prices.aiInPerTok, call.ended_at);
      addCost(call, enquiry.id, "ai_out_tok", between(280, 640), input.prices.aiOutPerTok, call.ended_at);
      if (slip) {
        addTask({ enquiryId: enquiry.id, kind: "alert", reason: "Safety check failed: the agent said a price figure or asked about budget", payload: { call_id: call.id, vaani_call_id: call.vaani_call_id, ...call.grader_flags, notify: ["founder"] }, created: call.ended_at, doneAfterMin: 35 });
      }
      plan.handoffs.push(handoffFor(enquiry, call, persona, designer, outcome));
      qualifiedStories.push({ enquiry, call, consult, designer, booked: persona.booked });
      firstCallers.push({ caller, first: callerFirst, last, kind: "qualified" });
      return;
    }

    if (kind.startsWith("nq_")) {
      const reason = kind.slice(3) as NotQualifiedReason;
      const place = reason === "C2" ? pick(OUT_AREA) : locality;
      const home = pick(["2BHK", "3BHK", "flat"]);
      const failId = ["C1", "C2", "C3", "C4"].includes(reason) ? reason : null;
      const criteria: Criterion[] = (["C1", "C2", "C3", "C4", "C5"] as const).map((id): Criterion => {
        if (id === failId) {
          const fail = { C1: "advice only", C2: `${place} is outside the service area`, C3: "needs completion in about 3 weeks", C4: "clearly below what this scope costs" }[id as "C1" | "C2" | "C3" | "C4"];
          const evidence = { C1: "Just the advice, really.", C2: place, C3: "We're moving in about three weeks", C4: "We have about two lakh for the whole flat." }[id as "C1" | "C2" | "C3" | "C4"];
          return { id, state: "fail", reason: fail, evidence };
        }
        if (id === "C2") return { id, state: "pass", reason: `${place} is in Pune city or PCMC`, evidence: place };
        if (id === "C4" || id === "C5") return { id, state: "not_mentioned", reason: id === "C4" ? "budget not mentioned (counts as qualified)" : "decision-maker not discussed", evidence: "" };
        if (id === "C1") return reason === "structural" ? { id, state: "not_mentioned", reason: "unclear whether execution is wanted", evidence: "" } : { id, state: "pass", reason: "design with execution", evidence: "" };
        return { id, state: "not_mentioned", reason: "no usable timeline", evidence: "" };
      });
      const enquiry = newEnquiry({
        caller_id: caller.id,
        outcome: "NOT_QUALIFIED",
        criteria,
        flags: reason === "C3" ? ["nurture"] : [],
        facts: { intent: "new", locality: place, scope_text: reason === "segment" ? "cafe interiors" : reason === "too_large" ? "office fit-out, 8,000 sq ft" : `${home} interiors`, ...(reason === "too_large" ? { project_type: "commercial", property_kind: "office", sqft: 8000 } : {}), ...(reason === "structural" ? { work_type: "structural" } : {}), ...(reason === "C1" ? { work_type: "advice_only" } : {}) },
        asked: reason === "C1" ? ["C1"] : reason === "C3" ? ["C3"] : [],
        created_at: start,
      });
      const label = { C1: "wants advice only, no execution", C2: `site is in ${place}, outside Pune and PCMC`, C3: "needs completion in about three weeks", C4: "budget is clearly below the scope", segment: "a cafe, which the studio does not take on", structural: "structural work only", too_large: "an office larger than the studio takes on" }[reason];
      addCall({ caller, enquiryId: enquiry.id, start, seconds: between(110, 230), turns: notQualifiedTurns(callerFirst, reason, { locality: place, home }), summary: `${callerFirst} enquired about ${reason === "segment" ? "a cafe" : `a ${home}`} in ${place}; not qualified: ${label}. Closed politely.` });
      firstCallers.push({ caller, first: callerFirst, last, kind });
      return;
    }

    if (kind === "needs_human") {
      const enquiry = newEnquiry({
        caller_id: caller.id,
        outcome: "NEEDS_HUMAN",
        criteria: [
          { id: "C1", state: "pass", reason: "design with execution", evidence: "Joining two flats and redoing both." },
          { id: "C2", state: "pass", reason: `${locality} is in Pune city or PCMC`, evidence: locality },
          { id: "C3", state: "not_mentioned", reason: "no usable timeline", evidence: "" },
          { id: "C4", state: "not_mentioned", reason: "budget not mentioned (counts as qualified)", evidence: "" },
          { id: "C5", state: "not_mentioned", reason: "decision-maker not discussed", evidence: "" },
        ],
        flags: ["asked_for_person"],
        facts: { intent: "new", locality, wants_human: true, scope_text: "joining two flats and redoing both" },
        created_at: start,
      });
      const call = addCall({ caller, enquiryId: enquiry.id, start, seconds: between(90, 160), turns: needsHumanTurns(callerFirst, locality, callbackWords(start)), summary: `${callerFirst} wants to join two flats in ${locality} and asked to speak to a person. Callback promised.` });
      // Done on time: the callback task carries no due time (see constants.ts, pendingTasks).
      addTask({ enquiryId: enquiry.id, kind: "callback", reason: "Caller needs a person", payload: { call_id: call.id }, created: call.ended_at, doneAfterMin: slot.afterHours ? 13 * 60 : between(8, 28) });
      firstCallers.push({ caller, first: callerFirst, last, kind });
      return;
    }

    if (kind === "existing") {
      const issue = isRepeat ? ISSUES[0] : pick(ISSUES);
      const enquiry = newEnquiry({ caller_id: caller.id, intent: "existing", outcome: "NOT_ENQUIRY", flags: ["existing_client"], facts: { intent: "existing" }, created_at: start });
      const call = addCall({ caller, enquiryId: enquiry.id, start, seconds: between(80, 150), turns: existingClientTurns(callerFirst, issue, callbackWords(start), isRepeat), summary: `Existing client ${callerFirst}${isRepeat ? " called again" : ""}: ${issue}. Passed to a senior for an urgent callback.` });
      addTask({ enquiryId: enquiry.id, kind: "urgent", reason: "Existing client needs a senior callback", payload: { phone: caller.phone_e164, summary: issue, call_id: call.id, notify: ["founder", "front_desk"] }, created: call.ended_at, doneAfterMin: isRepeat ? 25 : 90 });
      firstCallers.push({ caller, first: callerFirst, last, kind });
      return;
    }

    if (kind === "vendor" || kind === "job" || kind === "reschedule") {
      const enquiry = newEnquiry({ caller_id: caller.id, intent: "other", outcome: "NOT_ENQUIRY", flags: ["message"], facts: { intent: "other" }, created_at: start });
      const what = { vendor: "a laminates distributor wants to drop off samples", job: "a design graduate asked about junior or intern roles", reschedule: "a booked client wants to move the consultation" }[kind];
      const call = addCall({ caller, enquiryId: enquiry.id, start, seconds: between(55, 110), turns: messageTurns(callerFirst, kind), summary: `Message: ${what}. Passed to the front desk.` });
      addTask({ enquiryId: enquiry.id, kind: "message", reason: "Message for the front desk", payload: { phone: caller.phone_e164, summary: what, call_id: call.id, notify: ["front_desk"] }, created: call.ended_at, doneAfterMin: between(30, 240) });
      firstCallers.push({ caller, first: callerFirst, last, kind });
      return;
    }

    // Dropped before an outcome. The callback has already been placed (or handed to a person), so the
    // dropped-call follow-up never selects it.
    const enquiry = newEnquiry({
      caller_id: caller.id,
      outcome: "PENDING",
      criteria: [
        { id: "C1", state: "not_mentioned", reason: "unclear whether execution is wanted", evidence: "" },
        { id: "C2", state: "pass", reason: `${locality} is in Pune city or PCMC`, evidence: locality },
        { id: "C3", state: "not_mentioned", reason: "no usable timeline", evidence: "" },
        { id: "C4", state: "not_mentioned", reason: "budget not mentioned (counts as qualified)", evidence: "" },
        { id: "C5", state: "not_mentioned", reason: "decision-maker not discussed", evidence: "" },
      ],
      facts: { intent: "new", locality },
      created_at: start,
    });
    const call = addCall({ caller, enquiryId: enquiry.id, start, seconds: between(18, 55), turns: droppedTurns(caller.name ? callerFirst : null, locality), summary: `Call dropped after ${caller.name ? callerFirst : "the caller"} mentioned a flat in ${locality}.`, dropped: true });
    call.callback_placed_at = new Date(call.ended_at.getTime() + 5 * MIN);
    if (index % 2 === 0 && caller.name !== null) {
      addCall({ caller, enquiryId: enquiry.id, start: call.callback_placed_at, seconds: between(35, 60), turns: callbackTurns(callerFirst), summary: `Callback after the dropped call; ${callerFirst} was driving and will call back.`, direction: "out", callbackOf: call.id });
    } else {
      addTask({ enquiryId: enquiry.id, kind: "callback", reason: "Call dropped before the enquiry was finished", payload: { call_id: call.id, phone: caller.phone_e164 }, created: call.callback_placed_at, doneAfterMin: slot.afterHours ? 12 * 60 : between(6, 25) });
    }
    firstCallers.push({ caller, first: callerFirst, last, kind });
  });

  // 3. Bookings. Recent qualified calls hold today's and tomorrow's consultations, with two designers
  // booked at the same hour tomorrow; older ones were held, and most of those have a result.
  const tomorrow = (hour: number, minute: number) => fromIst(today.year, today.month, today.day + 1, hour, minute);
  const roundHalfHour = (date: Date) => new Date(Math.ceil(date.getTime() / (30 * MIN)) * 30 * MIN);
  const special: { at: Date; consult?: Consult }[] = [
    { at: tomorrow(11, 0), consult: "studio" },
    { at: tomorrow(11, 0), consult: "site" },
    { at: tomorrow(15, 0), consult: "principal" },
    { at: tomorrow(17, 30) },
    { at: roundHalfHour(new Date(now.getTime() + 80 * MIN)), consult: "site" },
    { at: roundHalfHour(new Date(now.getTime() + 200 * MIN)) },
    { at: new Date(Math.floor((now.getTime() - 150 * MIN) / (30 * MIN)) * 30 * MIN), consult: "studio" },
  ];
  const recent = qualifiedStories.filter((s) => s.booked && s.call.started_at.getTime() > now.getTime() - 5 * DAY).reverse();
  const specialFor = new Map<string, Date>();
  for (const slot of special) {
    const story = recent.find((s) => !specialFor.has(s.enquiry.id) && (!slot.consult || s.consult === slot.consult) && s.call.ended_at < slot.at) ?? recent.find((s) => !specialFor.has(s.enquiry.id) && s.call.ended_at < slot.at);
    if (story) specialFor.set(story.enquiry.id, slot.at);
  }

  qualifiedStories.forEach((story, index) => {
    const { enquiry, call, consult } = story;
    const fixed = specialFor.get(enquiry.id);
    if (!story.booked) return; // a few callers wanted a call before booking
    let startAt = fixed;
    if (!startAt) {
      let candidate = new Date(call.started_at.getTime() + (2 + (index % 5)) * DAY);
      while (!office.days.includes(istParts(candidate).weekday)) candidate = new Date(candidate.getTime() + DAY);
      const [hour, minute] = SLOT_TIMES[index % SLOT_TIMES.length];
      startAt = at(candidate, hour, minute);
    }
    const status: BookingRow["status"] = fixed ? (index % 3 === 0 ? "rescheduled" : "booked") : index % 11 === 3 ? "cancelled" : index % 7 === 2 ? "rescheduled" : "booked";
    const minutes = consult === "studio" ? 60 : 90;
    const designerId = story.designer?.id ?? null;
    plan.bookings.push({
      id: randomUUID(),
      enquiry_id: enquiry.id,
      calcom_uid: `${DEMO_ID_PREFIX}${String(plan.bookings.length + 1).padStart(4, "0")}`,
      consult_type: consult,
      start_at: startAt,
      end_at: new Date(startAt.getTime() + minutes * MIN),
      designer_id: designerId,
      status,
      created_at: call.ended_at,
      updated_at: status === "booked" ? call.ended_at : new Date(Math.min(call.ended_at.getTime() + DAY, now.getTime() - MIN)),
    });
    if (status === "cancelled") return;
    const held = startAt.getTime() < now.getTime();
    const daysSince = (now.getTime() - startAt.getTime()) / DAY;
    if (held && daysSince > 2 && index % 5 !== 1) {
      const won = index % 5 === 0 || index % 5 === 2 || (index % 5 === 3 && index % 2 === 0);
      enquiry.consult_result = won ? "won" : "lost";
      enquiry.consult_result_at = new Date(startAt.getTime() + (1 + (index % 3)) * DAY);
      if (enquiry.consult_result_at > now) enquiry.consult_result_at = new Date(now.getTime() - 60 * MIN);
      enquiry.updated_at = enquiry.consult_result_at;
      return;
    }
    // Awaiting a result (held but not recorded yet, or still upcoming). The booking will age into the
    // outcome-nudge query, so the nudge counter sits at the cap: no nudge can ever be due.
    enquiry.outcome_nudges = NUDGE_CAP;
    enquiry.last_nudge_at = new Date(Math.max(call.ended_at.getTime(), Math.min(startAt.getTime() + DAY, now.getTime() - 30 * MIN)));
  });

  // 4. Fixed monthly costs for each month the demo touches, under clearly-marked item names.
  const months = new Set<string>();
  for (let daysAgo = 41; daysAgo >= 0; daysAgo -= 7) months.add(isoMonth(dayStart(daysAgo)));
  months.add(isoMonth(now));
  for (const month of [...months].sort()) {
    plan.fixed_costs.push(
      { month, item: `${DEMO_FIXED_COST_PREFIX}Vaani plan`, amount_inr: 2499 },
      { month, item: `${DEMO_FIXED_COST_PREFIX}Phone number rental`, amount_inr: 499 },
      { month, item: `${DEMO_FIXED_COST_PREFIX}Hosting and database`, amount_inr: 1850 },
    );
  }

  plan.eval_runs = evalRuns(now);
  return plan;

  function handoffFor(enquiry: EnquiryRow, call: CallRow, persona: Persona, designer: Designer | null, outcome: string): HandoffRow {
    const posted = new Date(call.ended_at.getTime() + between(35, 80) * 1000);
    // Fast, slow and escalated acceptances; the reminder and escalation times follow the job's own
    // office-minute clock, so the timeline reads exactly as the real job would have written it.
    const roll = random();
    const officeStart = isOffice(posted, office) ? posted : nextOfficeOpen(posted, office);
    let accepted: Date | null =
      roll < 0.62 ? new Date(officeStart.getTime() + between(2, 12) * MIN) : roll < 0.84 ? addOfficeMinutes(posted, between(17, 29), office) : roll < 0.95 ? addOfficeMinutes(posted, between(38, 110), office) : null;
    const escalateAt = addOfficeMinutes(posted, input.acceptEscalateMin, office);
    if (accepted && accepted.getTime() > now.getTime() - MIN) accepted = escalateAt.getTime() < now.getTime() - MIN ? null : new Date(Math.min(posted.getTime() + 2 * MIN, now.getTime() - MIN));
    // Never accepted: it must have been escalated already, or the job would remind/escalate it.
    if (!accepted && escalateAt.getTime() > now.getTime() - MIN) accepted = new Date(Math.min(posted.getTime() + 2 * MIN, now.getTime() - MIN));
    const waited = accepted ? officeMinutesBetween(posted, accepted, office) : Number.POSITIVE_INFINITY;
    const reminded = waited >= input.acceptReminderMin ? addOfficeMinutes(posted, input.acceptReminderMin, office) : null;
    const escalated = waited >= input.acceptEscalateMin ? escalateAt : null;
    return {
      id: randomUUID(),
      enquiry_id: enquiry.id,
      chat_id: NO_CHAT,
      message_id: messageId++,
      note: {
        client_name: persona.first,
        one_line_summary: `${persona.home} in ${persona.locality}: ${persona.scope}.`,
        area: persona.locality,
        property: persona.home,
        size_sqft: persona.sqft,
        scope: persona.scope,
        timeline: persona.deadline,
        decision_maker: persona.decider,
        budget_mentioned: null,
        style_or_preferences: persona.style,
        referral: persona.referral,
        outcome,
      },
      posted_at: posted,
      accepted_by: accepted ? (designer?.id ?? null) : null,
      accepted_at: accepted,
      reminded_at: reminded,
      escalated_at: escalated,
    };
  }
}

function isoMonth(date: Date): string {
  const p = istParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-01`;
}

// A few eval runs per eval for the quality page, older first, the latest passing. Inserted only for
// evals with no real runs (see db.ts), so a demo result never sits on top of a real one.
function evalRuns(now: Date): EvalRunRow[] {
  const specs: { name: string; metrics: Record<string, number>; earlier: Record<string, number>; thresholds: EvalRunRow["thresholds"]; cost: number }[] = [
    { name: "gate-accuracy", metrics: { agreement: 0.962, false_qualified: 0, price_leakage: 0, items: 80 }, earlier: { agreement: 0.912 }, thresholds: [{ metric: "agreement", op: ">=", value: 0.9 }, { metric: "false_qualified", op: "==", value: 0, hard: true }, { metric: "price_leakage", op: "==", value: 0, hard: true }], cost: 0 },
    { name: "agent-sim", metrics: { outcome_rate: 0.94, tool_correct_rate: 0.97, one_question_rate: 0.98, price_leakage: 0, budget_asked: 0, items: 50 }, earlier: { outcome_rate: 0.88, budget_asked: 1 }, thresholds: [{ metric: "outcome_rate", op: ">=", value: 0.9 }, { metric: "tool_correct_rate", op: ">=", value: 0.95 }, { metric: "one_question_rate", op: ">=", value: 0.95 }, { metric: "price_leakage", op: "==", value: 0, hard: true }, { metric: "budget_asked", op: "==", value: 0, hard: true }], cost: 184.5 },
    { name: "note-accuracy", metrics: { field_accuracy: 0.968, unsupported_statements: 0, items: 30 }, earlier: { field_accuracy: 0.951 }, thresholds: [{ metric: "field_accuracy", op: ">=", value: 0.95 }, { metric: "unsupported_statements", op: "==", value: 0, hard: true }], cost: 12.4 },
    { name: "tool-latency", metrics: { p95_ms: 842, server_errors: 0 }, earlier: { p95_ms: 1120 }, thresholds: [{ metric: "p95_ms", op: "<=", value: 1500 }, { metric: "server_errors", op: "==", value: 0, hard: true }], cost: 0 },
    { name: "slot-compliance", metrics: { inside_window_rate: 1, booking_success_rate: 0.99 }, earlier: { booking_success_rate: 0.97 }, thresholds: [{ metric: "inside_window_rate", op: ">=", value: 0.95 }, { metric: "booking_success_rate", op: ">=", value: 0.98 }], cost: 0 },
    { name: "week-simulation", metrics: { missed: 0, duplicates: 0, on_time_rate: 1 }, earlier: { on_time_rate: 1 }, thresholds: [{ metric: "missed", op: "==", value: 0, hard: true }, { metric: "duplicates", op: "==", value: 0, hard: true }, { metric: "on_time_rate", op: "==", value: 1 }], cost: 0 },
  ];
  const runs: EvalRunRow[] = [];
  specs.forEach((spec, index) => {
    [30, 16, 3].forEach((daysAgo, run) => {
      const metrics = run === 0 ? { ...spec.metrics, ...spec.earlier } : spec.metrics;
      const failed = spec.thresholds
        .filter(({ metric, op, value }) => (op === ">=" ? metrics[metric] < value : op === "<=" ? metrics[metric] > value : metrics[metric] !== value))
        .map(({ metric, op, value, hard }) => `${hard ? "[hard] " : ""}${metric} ${op} ${value} (got ${metrics[metric]})`);
      const started = new Date(now.getTime() - daysAgo * DAY - (index * 7 + 40) * MIN);
      runs.push({
        id: randomUUID(),
        eval_name: spec.name,
        dataset_version: DEMO_EVAL_DATASET,
        commit_sha: DEMO_EVAL_COMMIT,
        prompt_version: run === 0 ? "frontdesk-v6" : PROMPT_VERSION,
        started_at: started,
        finished_at: new Date(started.getTime() + (3 + index) * MIN),
        metrics,
        thresholds: spec.thresholds,
        failed_thresholds: failed,
        passed: failed.length === 0,
        cost_inr: spec.cost,
      });
    });
  });
  return runs;
}
