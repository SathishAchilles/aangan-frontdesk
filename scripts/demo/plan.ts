// Builds the demo data set in memory: about six weeks of calls ending "now", growing week on week so
// the last fortnight is clearly busier than the one before, plus a full consultation calendar for
// every designer this week and next. A pure function of its inputs (a fixed pseudo-random seed), so
// reruns on the same day produce the same shape. Every row is built in its final, inert state; see
// ./constants.ts for why each choice is safe.
import { randomUUID } from "node:crypto";
import { safetyFlags } from "../../src/lib/pipeline/vaani-events";
import { addOfficeMinutes, describeCallback, nextOfficeOpen, type OfficeConfig, officeMinutesBetween } from "../../src/lib/rules/office-time";
import { DAY_KEYS, type DayKey, fromIst, istParts } from "../../src/lib/rules/time";
import { DEMO_EVAL_COMMIT, DEMO_EVAL_DATASET, DEMO_FIXED_COST_PREFIX, DEMO_ID_PREFIX, demoPhone, NUDGE_CAP, SENIOR_CALLBACK_WITHIN_MIN } from "./constants";
import {
  callbackTurns,
  droppedTurns,
  existingClientTurns,
  messageTurns,
  needsHumanTurns,
  noSlotTurns,
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
  callbackWithinMin: number;
  afterHoursCallbackTime: string;
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
// Every demo task belongs to a demo enquiry (removal finds tasks through their enquiry) and carries a
// chat id, so the Telegram dispatcher never picks one up. Open tasks are only of kinds and shapes the
// follow-ups job never selects (constants.ts).
export type TaskRow = {
  id: string;
  enquiry_id: string;
  kind: "callback" | "rebook" | "urgent" | "message" | "review" | "alert";
  reason: string;
  payload: Record<string, unknown>;
  due_at: Date | null;
  chat_id: number;
  message_id: number;
  done_at: Date | null;
  done_by: string | null;
  escalated_at: Date | null;
  created_at: Date;
};
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
const HOUR = 60 * MIN;
const DAY = 86_400_000;

// The designers calendar shows Monday-to-Sunday weeks. The demo fills this week and next.
export function demoWeeks(now: Date): { thisWeek: Date; nextWeek: Date; end: Date } {
  const p = istParts(now);
  const back = (DAY_KEYS.indexOf(p.weekday) + 6) % 7;
  const thisWeek = fromIst(p.year, p.month, p.day - back, 0, 0);
  return { thisWeek, nextWeek: new Date(thisWeek.getTime() + 7 * DAY), end: new Date(thisWeek.getTime() + 14 * DAY) };
}

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

// Call volume: a steady climb over six weeks, a weekday rhythm (Mondays busiest, Sundays quietest)
// and a few spikes: a small one in the prior fortnight, then a home-show feature nine days ago and a
// referral wave three days ago.
const DOW_FACTOR: Record<DayKey, number> = { sun: 0.35, mon: 1.15, tue: 1.05, wed: 1, thu: 0.95, fri: 0.9, sat: 0.55 };
const SPIKES: Record<number, number> = { 20: 2, 9: 5, 3: 4 };
// Today: every outcome, earliest first; the existing-client complaint is left open (constants.ts).
const TODAY_KINDS = ["existing", "qualified", "nq_C2", "needs_human", "notes_decider", "dropped", "vendor", "qualified"] as const;
const TODAY_SPREAD = [0.3, 0.45, 0.56, 0.66, 0.75, 0.83, 0.91, 1];
// Per designer, in order of their handoffs: mostly fast, some reminded, a few escalated.
const ACCEPT_PATTERN = ["fast", "fast", "slow", "fast", "late", "fast", "slow", "fast", "fast", "slow", "fast", "late", "fast", "fast", "unaccepted"] as const;
// Per designer, in order of their held consultations: about four in ten won, one awaiting a result.
const RESULT_PATTERN = ["won", "lost", "lost", "won", "pending", "lost", "won", "lost", "won", "lost"] as const;
// Share of callbacks done after their due time.
const LATE_SHARE = 0.15;

type Kind =
  | "qualified"
  | "notes_decider"
  | "notes_behalf"
  | "price_slip"
  | "budget_slip"
  | "booking_not_made"
  | `nq_${NotQualifiedReason}`
  | "needs_human"
  | "existing"
  | "vendor"
  | "job"
  | "reschedule"
  | "dropped";

type Slot = { start: Date; afterHours: boolean; daysAgo: number };
type Story = {
  enquiry: EnquiryRow;
  call: CallRow;
  consult: Consult;
  persona: Persona;
  outcome: string;
  booked: boolean;
  // When the booking was made: the end of the call, or the end of the callback that fixed a time.
  readyAt: Date;
  viaCallback: boolean;
  designer: Designer | null;
};

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
  const latest = now.getTime() - MIN;

  // 1. Call slots, six weeks back to today.
  const slots: Slot[] = [];
  for (let daysAgo = 41; daysAgo >= 1; daysAgo -= 1) {
    const day = dayStart(daysAgo);
    const weekday = istParts(day).weekday;
    const officeDay = office.days.includes(weekday);
    const trend = 2.2 + 4.3 * ((41 - daysAgo) / 40) ** 1.6;
    const count = Math.max(officeDay ? 1 : 0, Math.round(trend * DOW_FACTOR[weekday] + (random() - 0.5) * 1.6)) + (SPIKES[daysAgo] ?? 0);
    for (let i = 0; i < count; i += 1) {
      const afterHours = !officeDay || random() < 0.22;
      const [hour, minute] = afterHours ? pick([[7, 40], [8, 55], [19, 20], [20, 5], [21, 35], [22, 10], [11, 15], [16, 40]] as const) : [between(10, 18), pick([0, 10, 20, 30, 40, 50])];
      slots.push({ start: at(day, hour, minute), afterHours: afterHours && !isOffice(at(day, hour, minute), office), daysAgo });
    }
  }
  slots.sort((a, b) => a.start.getTime() - b.start.getTime());
  // Today: a fixed number of calls between midnight and 25 minutes ago, so the count depends only on
  // the date and the latest call has long ended before the job could look at it.
  const todayKinds = TODAY_KINDS.slice(0, office.days.includes(today.weekday) ? 8 : 6);
  const todayFrom = dayStart(0).getTime();
  const todayTo = now.getTime() - 25 * MIN;
  const firstToday = slots.length;
  TODAY_SPREAD.slice(-todayKinds.length).forEach((fraction, i) => {
    const raw = todayTo - todayFrom >= 30 * MIN ? todayFrom + (todayTo - todayFrom) * fraction : todayTo - (todayKinds.length - 1 - i) * 4 * MIN;
    const start = new Date(Math.floor(raw / MIN) * MIN);
    slots.push({ start, afterHours: !isOffice(start, office), daysAgo: 0 });
  });

  // 2. A story per slot. Every scenario appears at least once; the rest follow a realistic mix.
  const mix: [Kind, number][] = [
    ["qualified", 38],
    ["notes_decider", 9],
    ["notes_behalf", 7],
    ["booking_not_made", 3],
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
  const kinds: Kind[] = slots.map((_, index) => {
    if (index >= firstToday) return todayKinds[index - firstToday];
    let roll = random() * totalWeight;
    for (const [kind, weight] of mix) {
      roll -= weight;
      if (roll < 0) return kind;
    }
    return "qualified";
  });
  const forced = new Set<number>();
  // Recent stories the dashboard panels need, each replacing an ordinary qualified call in a window.
  const force = (kind: Kind, minDaysAgo: number, maxDaysAgo: number): number => {
    for (let i = firstToday - 1; i >= 0; i -= 1) {
      const slot = slots[i];
      if (slot.daysAgo >= minDaysAgo && slot.daysAgo <= maxDaysAgo && kinds[i] === "qualified" && !forced.has(i)) {
        kinds[i] = kind;
        forced.add(i);
        return i;
      }
    }
    throw new Error(`No slot left for the ${kind} story between ${minDaysAgo} and ${maxDaysAgo} days ago`);
  };
  // The callback the agent promises on the call, worded and timed the way the tools do it.
  const promise = (at: Date, withinMin = input.callbackWithinMin) => describeCallback(at, office, withinMin, input.afterHoursCallbackTime);
  // The price slip sits inside the 7-day safety window with its alert still open. One callback is
  // left open and escalated: the most recent of two candidates whose due time has passed.
  const openAlertSlot = force("price_slip", 2, 5);
  const openCallbackSlot = [force("needs_human", 1, 3), force("needs_human", 3, 6)].find((i) => promise(slots[i].start).at.getTime() < now.getTime() - 10 * MIN) ?? -1;
  force("booking_not_made", 4, 8);
  force("booking_not_made", 10, 16);
  force("booking_not_made", 17, 24);
  const required: Kind[] = ["budget_slip", "nq_C1", "nq_C2", "nq_C3", "nq_C4", "nq_segment", "nq_structural", "nq_too_large", "needs_human", "existing", "vendor", "job", "reschedule", "dropped", "notes_decider", "notes_behalf"];
  required.forEach((kind, index) => {
    if (kind !== "budget_slip" && kinds.slice(0, firstToday).includes(kind)) return;
    // Spread forced stories over the older weeks, replacing an ordinary qualified call.
    let target = 3 + index * Math.floor((firstToday - 20) / required.length);
    while (target < firstToday && (kinds[target] !== "qualified" || forced.has(target))) target += 1;
    if (target >= firstToday) throw new Error(`No slot left for the ${kind} story`);
    kinds[target] = kind;
    forced.add(target);
  });
  for (const kind of [...required, "price_slip", "booking_not_made"] as Kind[]) if (!kinds.includes(kind)) throw new Error(`Demo plan is missing the ${kind} story`);

  const plan: DemoPlan = { callers: [], enquiries: [], calls: [], bookings: [], handoffs: [], tasks: [], cost_lines: [], fixed_costs: [], eval_runs: [] };
  const designers = input.designers;
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

  // When a task was done. A task due later than now was done early (an open one would be picked up
  // by the job once due). Otherwise most are done before the due time and some after it; a late
  // callback was escalated to the founder by the job a minute or two after it fell due, exactly as
  // callbackOverdue() would have done.
  const settle = (created: Date, due: Date | null, escalates: boolean, alwaysLate = false): { done: Date; escalated: Date | null } => {
    if (!due) return { done: new Date(Math.min(created.getTime() + between(20, 240) * MIN, latest)), escalated: null };
    if (due.getTime() >= latest) return { done: new Date(Math.min(created.getTime() + between(6, 30) * MIN, latest)), escalated: null };
    const late = alwaysLate || due.getTime() - created.getTime() < 4 * MIN || random() < LATE_SHARE;
    if (late) {
      const done = new Date(Math.min(due.getTime() + between(9, 150) * MIN, latest));
      return { done, escalated: escalates ? new Date(Math.min(due.getTime() + between(1, 2) * MIN, done.getTime())) : null };
    }
    return { done: new Date(Math.max(created.getTime() + 3 * MIN, due.getTime() - between(3, 25) * MIN)), escalated: null };
  };
  const addTask = (o: { enquiryId: string; kind: TaskRow["kind"]; reason: string; payload: Record<string, unknown>; created: Date; due?: Date | null; done: Date | null; escalated?: Date | null; doneBy?: string | null }): TaskRow => {
    const row: TaskRow = {
      id: randomUUID(),
      enquiry_id: o.enquiryId,
      kind: o.kind,
      reason: o.reason,
      payload: o.payload,
      due_at: o.due ?? null,
      chat_id: NO_CHAT,
      message_id: messageId++,
      done_at: o.done,
      done_by: o.done ? (o.doneBy === undefined ? input.frontDeskId : o.doneBy) : null,
      escalated_at: o.escalated ?? null,
      created_at: o.created,
    };
    plan.tasks.push(row);
    return row;
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
  const firstCallers: { caller: CallerRow; first: string; last: string; kind: Kind }[] = [];
  const repeated = new Set<string>();
  const stories: Story[] = [];
  let openUrgentLeft = 1;

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

    if (kind === "qualified" || kind === "notes_decider" || kind === "notes_behalf" || kind === "price_slip" || kind === "budget_slip" || kind === "booking_not_made") {
      const noSlot = kind === "booking_not_made";
      // Callers who could not find a slot are flat owners, so any designer can take them.
      const home = pick(HOMES.filter((h) => (noSlot ? h.kind === "apartment" : h.kind !== "office" || kind === "qualified")));
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
        askedPrice: !noSlot && random() < 0.3,
        siteVisit,
        booked: noSlot || stories.length % 8 !== 5,
        consult,
      };
      const callback = promise(start);
      const turns = kind === "price_slip" ? slipTurns(persona, "price") : kind === "budget_slip" ? slipTurns(persona, "budget") : noSlot ? noSlotTurns(persona, callback.words) : qualifiedTurns(persona, notes);
      const outcome = noSlot ? "NEEDS_HUMAN" : notes === "none" ? "QUALIFIED" : "QUALIFIED_WITH_NOTES";
      const flags = [...(persona.referral ? ["referral"] : []), ...(notes === "none" ? [] : ["unclear_C5"]), ...(noSlot ? ["booking_not_made"] : [])];
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
      const enquiry = newEnquiry({
        caller_id: caller.id,
        outcome,
        criteria,
        flags,
        facts: { intent: "new", project_type: home.kind === "office" ? "commercial" : "residential", execution: "yes", scope_text: home.scope, property_kind: home.kind, sqft, locality, deadline_text: persona.deadline, ...(persona.decider ? { decision_text: persona.decider } : {}), ...(persona.referral ? { referral_text: persona.referral } : {}), wants_site_visit: siteVisit },
        asked: ["C1", "C3"],
        consult_type: consult,
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
        summary: noSlot
          ? `${callerFirst} wants ${home.scope} for a ${home.home} of about ${sqft.toLocaleString("en-IN")} sq ft in ${locality}, ${persona.deadline}. Qualified for a ${consult} consultation, but none of the offered times suited; handed to the team to call back ${callback.words} and fix a time.`
          : `${callerFirst} wants ${home.scope} for a ${home.home} of about ${sqft.toLocaleString("en-IN")} sq ft in ${locality}, ${persona.deadline}. ${outcome === "QUALIFIED" ? "Qualified" : "Qualified with notes (decision-maker unclear)"}; ${persona.booked ? `${consult} consultation booked` : `${consult} consultation offered; a designer will call to fix a time`}.${persona.askedPrice ? " Asked about cost; the agent explained pricing is discussed at the consultation." : ""}`,
      });
      let readyAt = call.ended_at;
      if (noSlot) {
        // The booking tool's handToPerson path: a callback to fix a time, then a booking made on it.
        const { done, escalated } = settle(call.ended_at, callback.at, true);
        addTask({ enquiryId: enquiry.id, kind: "callback", reason: "No offered slot suited the caller: call back to fix a consultation time", payload: { consult_type: consult, call_id: call.id }, created: call.ended_at, due: callback.at, done, escalated });
        readyAt = done;
      } else {
        // The post-call note (Gemini) cost.
        addCost(call, enquiry.id, "ai_in_tok", between(2600, 4800), input.prices.aiInPerTok, call.ended_at);
        addCost(call, enquiry.id, "ai_out_tok", between(280, 640), input.prices.aiOutPerTok, call.ended_at);
      }
      if (slip) {
        const open = index === openAlertSlot;
        addTask({ enquiryId: enquiry.id, kind: "alert", reason: "Safety check failed: the agent said a price figure or asked about budget", payload: { call_id: call.id, vaani_call_id: call.vaani_call_id, ...call.grader_flags, notify: ["founder"] }, created: call.ended_at, done: open ? null : new Date(Math.min(call.ended_at.getTime() + 35 * MIN, latest)) });
      }
      stories.push({ enquiry, call, consult, persona, outcome, booked: persona.booked, readyAt, viaCallback: noSlot, designer: null });
      firstCallers.push({ caller, first: callerFirst, last, kind: noSlot ? "booking_not_made" : "qualified" });
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
      const callback = promise(start);
      const call = addCall({ caller, enquiryId: enquiry.id, start, seconds: between(90, 160), turns: needsHumanTurns(callerFirst, locality, callback.words), summary: `${callerFirst} wants to join two flats in ${locality} and asked to speak to a person. Callback promised ${callback.words}.` });
      if (index === openCallbackSlot) {
        // Still open and already escalated: the job's callback query skips escalated tasks.
        addTask({ enquiryId: enquiry.id, kind: "callback", reason: "Caller needs a person", payload: { call_id: call.id }, created: call.ended_at, due: callback.at, done: null, escalated: new Date(callback.at.getTime() + 2 * MIN) });
      } else {
        const { done, escalated } = settle(call.ended_at, callback.at, true);
        addTask({ enquiryId: enquiry.id, kind: "callback", reason: "Caller needs a person", payload: { call_id: call.id }, created: call.ended_at, due: callback.at, done, escalated });
      }
      firstCallers.push({ caller, first: callerFirst, last, kind });
      return;
    }

    if (kind === "existing") {
      const issue = isRepeat ? ISSUES[0] : pick(ISSUES);
      const enquiry = newEnquiry({ caller_id: caller.id, intent: "existing", outcome: "NOT_ENQUIRY", flags: ["existing_client"], facts: { intent: "existing" }, created_at: start });
      const callback = promise(start, SENIOR_CALLBACK_WITHIN_MIN);
      const call = addCall({ caller, enquiryId: enquiry.id, start, seconds: between(80, 150), turns: existingClientTurns(callerFirst, issue, callback.words, isRepeat), summary: `Existing client ${callerFirst}${isRepeat ? " called again" : ""}: ${issue}. Passed to a senior for an urgent callback ${callback.words}.` });
      // Today's complaint stays open for the attention panel: nothing in the job reads urgent tasks.
      const open = slot.daysAgo === 0 && openUrgentLeft > 0;
      if (open) openUrgentLeft -= 1;
      const { done } = settle(call.ended_at, callback.at, false);
      addTask({ enquiryId: enquiry.id, kind: "urgent", reason: "Existing client needs a senior callback", payload: { phone: caller.phone_e164, summary: issue, call_id: call.id, notify: ["founder", "front_desk"] }, created: call.ended_at, due: callback.at, done: open ? null : done });
      firstCallers.push({ caller, first: callerFirst, last, kind });
      return;
    }

    if (kind === "vendor" || kind === "job" || kind === "reschedule") {
      const enquiry = newEnquiry({ caller_id: caller.id, intent: "other", outcome: "NOT_ENQUIRY", flags: ["message"], facts: { intent: "other" }, created_at: start });
      const what = { vendor: "a laminates distributor wants to drop off samples", job: "a design graduate asked about junior or intern roles", reschedule: "a booked client wants to move the consultation" }[kind];
      const call = addCall({ caller, enquiryId: enquiry.id, start, seconds: between(55, 110), turns: messageTurns(callerFirst, kind), summary: `Message: ${what}. Passed to the front desk.` });
      addTask({ enquiryId: enquiry.id, kind: "message", reason: "Message for the front desk", payload: { phone: caller.phone_e164, summary: what, call_id: call.id, notify: ["front_desk"] }, created: call.ended_at, done: settle(call.ended_at, null, false).done });
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
    call.callback_placed_at = new Date(Math.min(call.ended_at.getTime() + 5 * MIN, latest));
    if (index % 2 === 0 && caller.name !== null) {
      addCall({ caller, enquiryId: enquiry.id, start: call.callback_placed_at, seconds: between(35, 60), turns: callbackTurns(callerFirst), summary: `Callback after the dropped call; ${callerFirst} was driving and will call back.`, direction: "out", callbackOf: call.id });
    } else {
      // The job files this task due immediately (dueAt: now), so it is always done after its due
      // time and escalated on the next run, exactly as production records it.
      const created = call.callback_placed_at;
      const { done, escalated } = settle(created, created, true, true);
      addTask({ enquiryId: enquiry.id, kind: "callback", reason: "Call dropped before the enquiry was finished", payload: { call_id: call.id, phone: caller.phone_e164 }, created, due: created, done, escalated });
    }
    firstCallers.push({ caller, first: callerFirst, last, kind });
  });

  // 3. Bookings, calendar first. Each designer gets one or two consultations on every office day of
  // this week and next (plus one deliberate double-booking a week), each backed by a qualified call
  // made between three hours and two weeks earlier. Consultation types follow staff.consult_types.
  const durationMin = (consult: Consult) => (consult === "studio" ? 60 : 90);
  const fits = (designer: Designer, consult: Consult) => designer.consultTypes.length === 0 || designer.consultTypes.includes(consult);
  const eligible = (consult: Consult) => {
    const fit = designers.filter((d) => fits(d, consult));
    return fit.length > 0 ? fit : designers;
  };
  const busy = new Map<string, { start: number; end: number }[]>();
  const load = new Map<string, number>();
  const leastLoaded = (consult: Consult): Designer | null => {
    const pool = eligible(consult);
    if (pool.length === 0) return null;
    return pool.reduce((best, d) => ((load.get(d.id) ?? 0) < (load.get(best.id) ?? 0) ? d : best), pool[0]);
  };
  const assign = (story: Story, designer: Designer | null) => {
    story.designer = designer;
    story.enquiry.assigned_designer_id = designer?.id ?? null;
    if (designer) load.set(designer.id, (load.get(designer.id) ?? 0) + 1);
  };
  const resultCount = new Map<string, number>();

  const addBooking = (story: Story, startAt: Date, status: BookingRow["status"]) => {
    const { enquiry, consult } = story;
    const endAt = new Date(startAt.getTime() + durationMin(consult) * MIN);
    const created = story.readyAt;
    const changed = new Date(Math.max(created.getTime() + 5 * MIN, Math.min(created.getTime() + between(4, 30) * HOUR, now.getTime() - 20 * MIN)));
    const designerId = story.designer?.id ?? null;
    plan.bookings.push({
      id: randomUUID(),
      enquiry_id: enquiry.id,
      calcom_uid: `${DEMO_ID_PREFIX}${String(plan.bookings.length + 1).padStart(4, "0")}`,
      consult_type: consult,
      start_at: startAt,
      end_at: endAt,
      designer_id: designerId,
      status,
      created_at: created,
      updated_at: status === "booked" ? created : changed,
    });
    const key = designerId ?? "none";
    busy.set(key, [...(busy.get(key) ?? []), { start: startAt.getTime(), end: endAt.getTime() }]);
    // Cal.com changes are flagged the way the webhook flags them, minus sync_pending (constants.ts).
    if (status !== "booked") enquiry.flags = [...enquiry.flags, `booking_${status}`];
    if (status === "cancelled") {
      const done = new Date(Math.min(changed.getTime() + between(20, 300) * MIN, latest));
      addTask({ enquiryId: enquiry.id, kind: "rebook", reason: "Consultation cancelled: call the client and rebook", payload: { calcom_uid: plan.bookings[plan.bookings.length - 1].calcom_uid, cancellation_reason: pick(["Travelling that week", "Family function", "Need to check with my spouse first"]) }, created: changed, done });
      return;
    }
    const held = startAt.getTime() < now.getTime();
    const daysSince = (now.getTime() - startAt.getTime()) / DAY;
    if (held && daysSince > 2) {
      const n = resultCount.get(key) ?? 0;
      resultCount.set(key, n + 1);
      const result = RESULT_PATTERN[n % RESULT_PATTERN.length];
      if (result !== "pending") {
        enquiry.consult_result = result;
        enquiry.consult_result_at = new Date(Math.min(startAt.getTime() + (1 + (n % 3)) * DAY, now.getTime() - 60 * MIN));
        enquiry.updated_at = enquiry.consult_result_at;
        return;
      }
    }
    // Awaiting a result (held but not recorded yet, or still upcoming). The booking will age into the
    // outcome-nudge query, so the nudge counter sits at the cap: no nudge can ever be due.
    enquiry.outcome_nudges = NUDGE_CAP;
    enquiry.last_nudge_at = new Date(Math.max(story.readyAt.getTime(), Math.min(startAt.getTime() + DAY, now.getTime() - 30 * MIN)));
  };

  const { thisWeek } = demoWeeks(now);
  type GridSlot = { designer: Designer; start: Date; week: number; overlap: "first" | "second" | null };
  const grid: GridSlot[] = [];
  for (let week = 0; week < 2; week += 1) {
    let ordinal = 0;
    for (let d = 0; d < 7; d += 1) {
      const day = new Date(thisWeek.getTime() + (week * 7 + d) * DAY + 12 * HOUR);
      if (!office.days.includes(istParts(day).weekday)) continue;
      designers.forEach((designer, di) => {
        const firstTime = Math.floor(random() * SLOT_TIMES.length);
        const times = [SLOT_TIMES[firstTime], SLOT_TIMES[(firstTime + 2) % SLOT_TIMES.length]].slice(0, random() < 0.35 ? 2 : 1);
        // Once a week each designer is double-booked: a moved consultation lands half an hour into another.
        const doubled = ordinal === (di + 1 + week) % Math.max(1, office.days.length);
        times.forEach(([hour, minute], t) => grid.push({ designer, start: at(day, hour, minute), week, overlap: doubled && t === 0 ? "first" : null }));
        if (doubled) grid.push({ designer, start: at(day, times[0][0], times[0][1] + 30), week, overlap: "second" });
      });
      ordinal += 1;
    }
  }
  // Fill the double-bookings first, then the latest slots first, so next week (which only calls
  // already made can fill) is not starved by this week.
  const order = [...grid].sort((a, b) => Number(b.overlap !== null) - Number(a.overlap !== null) || b.start.getTime() - a.start.getTime() || a.designer.name.localeCompare(b.designer.name));
  const placed = new Map<Story, GridSlot>();
  const bookable = stories.filter((s) => s.booked && !s.viaCallback);
  order.forEach((slot, i) => {
    const target = (2 + (i % 6)) * DAY;
    let best: Story | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const story of bookable) {
      if (placed.has(story) || !eligible(story.consult).includes(slot.designer)) continue;
      const lead = slot.start.getTime() - story.readyAt.getTime();
      if (lead < 3 * HOUR || lead > 14 * DAY) continue;
      const score = Math.abs(lead - target);
      if (score < bestScore) {
        best = story;
        bestScore = score;
      }
    }
    if (best) placed.set(best, slot);
  });
  // In each designer's week, the second consultation was rescheduled and the third cancelled; the
  // half-hour clash is a rescheduled one.
  const perWeek = new Map<string, number>();
  [...placed.entries()]
    .sort(([, a], [, b]) => a.start.getTime() - b.start.getTime() || a.designer.name.localeCompare(b.designer.name))
    .forEach(([story, slot]) => {
      assign(story, slot.designer);
      const key = `${slot.designer.id}:${slot.week}`;
      const k = slot.overlap ? -1 : (perWeek.get(key) ?? 0);
      if (!slot.overlap) perWeek.set(key, k + 1);
      addBooking(story, slot.start, slot.overlap === "second" || k === 1 ? "rescheduled" : k === 2 ? "cancelled" : "booked");
    });

  // Everything else booked: the least-loaded designer who takes that consultation type (callers
  // booked after a callback go round the designers in turn), at their first free slot two to six
  // days after the booking was made.
  const freeSlot = (designer: Designer | null, from: Date, consult: Consult, offset: number): Date => {
    const taken = busy.get(designer?.id ?? "none") ?? [];
    for (let d = 0; d < 90; d += 1) {
      const day = new Date(from.getTime() + d * DAY);
      if (!office.days.includes(istParts(day).weekday)) continue;
      for (let t = 0; t < SLOT_TIMES.length; t += 1) {
        const [hour, minute] = SLOT_TIMES[(t + offset) % SLOT_TIMES.length];
        const start = at(day, hour, minute);
        const end = start.getTime() + durationMin(consult) * MIN;
        if (start.getTime() >= from.getTime() && !taken.some((b) => b.start < end && start.getTime() < b.end)) return start;
      }
    }
    throw new Error("No free consultation slot in 90 days");
  };
  let turn = 0;
  const nextInTurn = (consult: Consult): Designer | null => {
    for (let tries = 0; tries < designers.length; tries += 1) {
      const designer = designers[turn++ % designers.length];
      if (eligible(consult).includes(designer)) return designer;
    }
    return leastLoaded(consult);
  };
  stories
    .filter((s) => s.booked && !placed.has(s))
    .sort((a, b) => a.readyAt.getTime() - b.readyAt.getTime())
    .forEach((story, index) => {
      assign(story, story.viaCallback ? nextInTurn(story.consult) : leastLoaded(story.consult));
      const from = new Date(story.readyAt.getTime() + (2 + (index % 5)) * DAY);
      const startAt = freeSlot(story.designer, at(from, 0, 0), story.consult, index);
      addBooking(story, startAt, story.viaCallback ? "booked" : index % 11 === 3 ? "cancelled" : index % 7 === 2 ? "rescheduled" : "booked");
    });
  // A few callers wanted a call before booking: the designer who takes the lead calls them.
  for (const story of stories) if (!story.booked) assign(story, leastLoaded(story.consult));

  // 4. Handoffs for qualified calls, with the designer known: the same person is assigned, holds the
  // booking and accepts the handoff. Two recent ones were never accepted and were escalated.
  const qualified = stories.filter((s) => !s.viaCallback);
  const recent = qualified.filter((s) => s.call.started_at.getTime() < dayStart(2).getTime() && s.call.started_at.getTime() >= dayStart(10).getTime());
  const unaccepted = new Set([recent[0], recent[Math.floor(recent.length / 2)]].filter(Boolean));
  const acceptCount = new Map<string, number>();
  for (const story of qualified) plan.handoffs.push(handoffFor(story, unaccepted.has(story)));

  // 5. Fixed monthly costs for each month the demo touches, under clearly-marked item names.
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

  function handoffFor(story: Story, neverAccepted: boolean): HandoffRow {
    const { enquiry, call, persona, designer, outcome } = story;
    const posted = new Date(call.ended_at.getTime() + between(35, 80) * 1000);
    const key = designer?.id ?? "none";
    const n = acceptCount.get(key) ?? 0;
    acceptCount.set(key, n + 1);
    // Fast, slow and escalated acceptances; the reminder and escalation times follow the job's own
    // office-minute clock, so the timeline reads exactly as the real job would have written it.
    const escalateAt = addOfficeMinutes(posted, input.acceptEscalateMin, office);
    let kind: (typeof ACCEPT_PATTERN)[number] = neverAccepted ? "unaccepted" : ACCEPT_PATTERN[n % ACCEPT_PATTERN.length];
    if (kind === "unaccepted" && escalateAt.getTime() > latest) kind = "fast";
    const officeStart = isOffice(posted, office) ? posted : nextOfficeOpen(posted, office);
    let accepted: Date | null =
      kind === "fast"
        ? new Date(officeStart.getTime() + between(2, 12) * MIN)
        : kind === "slow"
          ? addOfficeMinutes(posted, between(input.acceptReminderMin + 2, Math.max(input.acceptReminderMin + 2, input.acceptEscalateMin - 1)), office)
          : kind === "late"
            ? addOfficeMinutes(posted, input.acceptEscalateMin + between(8, 80), office)
            : null;
    // Too recent to have waited that long: accepted within a few minutes of posting instead.
    if (accepted && accepted.getTime() > latest) accepted = new Date(Math.max(posted.getTime() + MIN, Math.min(posted.getTime() + 4 * MIN, latest)));
    const waited = accepted ? officeMinutesBetween(posted, accepted, office) : Number.POSITIVE_INFINITY;
    const reminded = waited >= input.acceptReminderMin ? addOfficeMinutes(posted, input.acceptReminderMin, office) : null;
    const escalated = waited >= input.acceptEscalateMin ? escalateAt : null;
    return {
      id: randomUUID(),
      enquiry_id: enquiry.id,
      chat_id: NO_CHAT,
      message_id: messageId++,
      note: noteFor(persona, outcome, enquiry.criteria, story.booked),
      posted_at: posted,
      accepted_by: accepted ? (designer?.id ?? null) : null,
      accepted_at: accepted,
      reminded_at: reminded,
      escalated_at: escalated,
    };
  }
}

// The post-call note in the shape prompts/note.md asks Gemini for (src/lib/note.ts noteSchema), in
// the caller's own words, never with a price. Watch-outs are what the designer should know first.
function noteFor(p: Persona, outcome: string, criteria: Criterion[], booked: boolean): Record<string, unknown> {
  const c5 = criteria.find((c) => c.id === "C5");
  const behalf = c5?.state === "unclear" && c5.reason.includes("someone else");
  const unclear = c5?.state === "unclear" && !behalf;
  const watchOuts = [
    ...(behalf ? ["Calling for their parents, who will decide; invite them to the consultation."] : []),
    ...(unclear ? ["Decision-maker not confirmed on the call; ask who else should join the consultation."] : []),
    ...(!booked ? ["Not booked yet: wants a call to fix a time after checking dates with family."] : []),
    ...(p.askedPrice ? ["Asked what it might cost; was told pricing is discussed at the consultation."] : []),
    ...(p.siteVisit ? ["Wants someone to see the place in person before deciding."] : []),
    ...(p.referral ? [`Referral: ${p.referral}.`] : []),
    ...(p.home === "office" ? ["Commercial fit-out; confirm working hours for site work."] : []),
    ...(p.deadline.includes("flexible") ? ["No fixed deadline."] : [`Timeline: ${p.deadline}.`]),
  ];
  return {
    client_name: p.first,
    area: p.locality,
    property: p.home,
    size_sqft: p.sqft,
    scope: `${p.scope[0].toUpperCase()}${p.scope.slice(1)}`,
    timeline: p.deadline,
    decision_maker: behalf ? "my parents, it's their flat. They'll decide." : p.decider,
    budget_mentioned: null,
    style_or_preferences: p.style,
    referral: p.referral,
    watch_outs: watchOuts,
    one_line_summary: `${p.home} in ${p.locality}: ${p.scope}.`,
    criteria: Object.fromEntries(criteria.map((c) => [c.id, c.state])),
    outcome,
  };
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
