// The qualification gate: qualified.md (five criteria, boundary rules) plus the hard exclusions in
// services.md. Pure function of the caller's facts, the questions already asked, and "now".
// No numeric score decides the outcome, and no output ever contains a cost figure.
import type { RulesConfig } from "./config";
import type { AskableCriterion, CriterionId, CriterionResult, Facts } from "./facts";
import { describeCallback } from "./office-time";
import { matchLocality, parseDeadline, parseMoneyInr, parseSqft } from "./parse";
import { weeksBetween } from "./time";
import {
  EXISTING_CLIENT_LINE,
  FAIL_LINES,
  type FailReason,
  MESSAGE_LINE,
  MULTI_FAIL_LINE,
  NEEDS_HUMAN_LINE,
  QUESTIONS,
} from "./wording";

export type Outcome = "PENDING" | "QUALIFIED" | "QUALIFIED_WITH_NOTES" | "NOT_QUALIFIED" | "NEEDS_HUMAN" | "NOT_ENQUIRY";
export type ConsultType = "studio" | "site" | "principal";

export type GateInput = {
  facts: Facts;
  asked: AskableCriterion[];
  now: Date;
  config: RulesConfig;
};

export type GateResult = {
  outcome: Outcome;
  criteria: CriterionResult[];
  fail_reasons: FailReason[];
  flags: string[];
  next_question?: string;
  ask?: AskableCriterion;
  say_line?: string;
  consult_type?: ConsultType;
  callback_at?: string;
};

const SEGMENT_FAIL = /\b(restaurants?|caf[eé]s?|hotels?|resorts?|hospitality|retail|shops?|showrooms?|gyms?|fitness)\b/i;
const ADVICE_ONLY =
  /\b(just (?:want|looking for) (?:some )?(?:ideas|suggestions|advice)|just exploring|come and (?:advise|give us (?:some )?ideas)|second opinion|consultation only|advice only|do the execution (?:ourselves|myself)|execution myself)\b/i;
const DESIGN_EXECUTION =
  /\b(redesign|redo|re-do|full (?:home|interiors|package|redesign|scope)|end[- ]to[- ]end|full execution|with execution|fit[- ]?out|modular kitchen|kitchen|wardrobes?|interiors?|workstations|furnish|flooring|design and execution)\b/i;
const DECIDES = /\b(i'?m the (?:owner|founder|decision[- ]maker)|we(?:'re| are) the owners?|my (?:husband|wife|partner) and i|(?:he|she|they) (?:knows|said|is happy|are happy)|go ahead|authori[sz]ed|i decide|both (?:want|will) (?:to )?be at|owner)\b/i;
const ON_BEHALF = /\b(for my (?:parents|in-laws|mother|father|mom|dad|boss|friend)|on behalf of|initial (?:research|checking)|just checking for|they(?:'ll| will) decide)\b/i;

function result(id: CriterionId, state: CriterionResult["state"], reason: string, evidence = ""): CriterionResult {
  return { id, state, reason, evidence };
}

function isCommercial(facts: Facts): boolean {
  return facts.project_type === "commercial" || facts.property_kind === "office";
}

function evaluateC1(facts: Facts): CriterionResult {
  const evidence = facts.scope_text ?? "";
  if (facts.work_type === "advice_only" || facts.work_type === "decor_only") return result("C1", "fail", "advice or styling only", evidence);
  if (facts.execution === "no") return result("C1", "fail", "no execution wanted", evidence);
  if (facts.execution === "yes" || facts.work_type === "design_execution") return result("C1", "pass", "design with execution", evidence);
  if (ADVICE_ONLY.test(evidence)) return result("C1", "fail", "advice only", evidence);
  if (DESIGN_EXECUTION.test(evidence)) return result("C1", "pass", "design with execution", evidence);
  return result("C1", evidence ? "unclear" : "not_mentioned", "unclear whether execution is wanted", evidence);
}

function evaluateC2(facts: Facts, config: RulesConfig): CriterionResult {
  const evidence = facts.locality ?? "";
  if (!evidence) return result("C2", "not_mentioned", "site area not given");
  const match = matchLocality(evidence, config.localities);
  if (!match) return result("C2", "unclear", "area not on the service-area list", evidence);
  return match.status === "in"
    ? result("C2", "pass", `${match.name} is in Pune city or PCMC`, evidence)
    : result("C2", "fail", `${match.name} is outside the service area`, evidence);
}

function evaluateC3(facts: Facts, now: Date, config: RulesConfig, flags: string[]): CriterionResult {
  const evidence = facts.deadline_text ?? "";
  const deadline = parseDeadline(evidence, now, config.festivals);
  if (deadline.kind === "unknown") return result("C3", evidence ? "unclear" : "not_mentioned", "no usable timeline", evidence);
  if (deadline.kind === "asap") return result("C3", "unclear", "'as soon as possible' gives no completion date", evidence);
  if (deadline.kind === "flexible") return result("C3", "pass", "no fixed deadline", evidence);
  if (deadline.kind === "start") return result("C3", "pass", "start date only; completion not constrained", evidence);
  const weeks = weeksBetween(now, deadline.date!);
  if (weeks < config.timelineHardFailWeeks) {
    return result("C3", "fail", `needs completion in about ${Math.max(0, Math.round(weeks))} weeks`, evidence);
  }
  if (weeks < config.timelineTightWeeks) {
    flags.push("tight_timeline");
    return result("C3", "pass", `about ${Math.round(weeks)} weeks: tight but possible`, evidence);
  }
  return result("C3", "pass", `about ${Math.round(weeks)} weeks`, evidence);
}

function budgetFloor(facts: Facts, config: RulesConfig): number | undefined {
  const sqft = facts.sqft ?? parseSqft(facts.scope_text);
  const floors = config.budgetFloors;
  if (isCommercial(facts)) return sqft ? sqft * floors.commercial_per_sqft : undefined;
  const rooms = facts.rooms?.length ?? 0;
  if (!facts.full_home && rooms > 0) return rooms * floors.single_room;
  return sqft ? sqft * floors.residential_per_sqft : undefined;
}

function evaluateC4(facts: Facts, config: RulesConfig): CriterionResult {
  const evidence = facts.budget_text ?? "";
  if (!evidence.trim()) return result("C4", "not_mentioned", "budget not mentioned (counts as qualified)");
  const money = parseMoneyInr(evidence);
  if (!money) return result("C4", "pass", "budget mentioned without a figure", evidence);
  const floor = budgetFloor(facts, config);
  if (!floor) return result("C4", "unclear", "scope too vague to judge the budget", evidence);
  return money.max < (floor * config.budgetClearlyBelowPct) / 100
    ? result("C4", "fail", "clearly below what this scope costs", evidence)
    : result("C4", "pass", "not clearly below this scope", evidence);
}

function evaluateC5(facts: Facts): CriterionResult {
  const evidence = facts.decision_text ?? "";
  if (!evidence.trim()) return result("C5", "not_mentioned", "decision-maker not discussed");
  if (ON_BEHALF.test(evidence)) return result("C5", "unclear", "caller is acting for someone else", evidence);
  if (DECIDES.test(evidence)) return result("C5", "pass", "caller decides or is authorised", evidence);
  return result("C5", "unclear", "decision-maker unclear", evidence);
}

function serviceFailures(facts: Facts, config: RulesConfig): FailReason[] {
  const failures: FailReason[] = [];
  if (SEGMENT_FAIL.test(facts.segment ?? "") || SEGMENT_FAIL.test(facts.scope_text ?? "")) failures.push("segment");
  if (facts.work_type === "structural") failures.push("structural");
  if (facts.work_type === "vastu_only" || facts.work_type === "furniture_only") failures.push("service_only");
  const sqft = facts.sqft ?? parseSqft(facts.scope_text);
  if (isCommercial(facts) && sqft && sqft > config.commercialMaxSqft) failures.push("too_large");
  if (isCommercial(facts) && sqft && sqft < config.commercialMinSqft && config.commercialBelowMinAction === "decline") {
    failures.push("too_small");
  }
  return failures;
}

function consultType(facts: Facts, config: RulesConfig): ConsultType {
  const sqft = facts.sqft ?? parseSqft(facts.scope_text) ?? 0;
  if (facts.property_kind === "villa" || facts.property_kind === "independent_house" || sqft >= config.principalVisitMinSqft) {
    return "principal";
  }
  return facts.wants_site_visit ? "site" : "studio";
}

export function evaluateEnquiry({ facts, asked, now, config }: GateInput): GateResult {
  const callback = (minutes: number) => describeCallback(now, config.office, minutes, config.afterHoursCallbackTime);

  if (facts.intent === "existing") {
    const promise = callback(config.seniorCallbackWithinMin);
    return {
      outcome: "NOT_ENQUIRY",
      criteria: [],
      fail_reasons: [],
      flags: ["existing_client"],
      say_line: EXISTING_CLIENT_LINE.replace("{when}", promise.words),
      callback_at: promise.at.toISOString(),
    };
  }
  if (facts.intent === "other") {
    return { outcome: "NOT_ENQUIRY", criteria: [], fail_reasons: [], flags: ["message"], say_line: MESSAGE_LINE };
  }

  const flags: string[] = [];
  if (facts.referral_text) flags.push("referral");
  if (facts.frustrated) flags.push("frustrated");
  const criteria = [
    evaluateC1(facts),
    evaluateC2(facts, config),
    evaluateC3(facts, now, config, flags),
    evaluateC4(facts, config),
    evaluateC5(facts),
  ];
  const byId = Object.fromEntries(criteria.map((criterion) => [criterion.id, criterion])) as Record<CriterionId, CriterionResult>;

  if (facts.wants_human) {
    const promise = callback(config.callbackWithinMin);
    return {
      outcome: "NEEDS_HUMAN",
      criteria,
      fail_reasons: [],
      flags: [...flags, "asked_for_person"],
      say_line: NEEDS_HUMAN_LINE.replace("{when}", promise.words),
      callback_at: promise.at.toISOString(),
    };
  }

  // A fail beats an unclear: close without asking anything else.
  const failReasons: FailReason[] = [
    ...serviceFailures(facts, config),
    ...criteria.filter((criterion) => criterion.state === "fail").map((criterion) => criterion.id as FailReason),
  ];
  if (failReasons.length > 0) {
    const onlyTimeline = failReasons.length === 1 && failReasons[0] === "C3";
    return {
      outcome: "NOT_QUALIFIED",
      criteria,
      fail_reasons: failReasons,
      flags: onlyTimeline ? [...flags, "nurture"] : flags,
      say_line: failReasons.length === 1 ? FAIL_LINES[failReasons[0]] : MULTI_FAIL_LINE,
    };
  }

  // One direct question per unclear C1-C3, in order, each asked at most once.
  const askable: AskableCriterion[] = ["C1", "C2", "C3"];
  const unclear = askable.filter((id) => byId[id].state === "unclear" || byId[id].state === "not_mentioned");
  const toAsk = unclear.find((id) => !asked.includes(id));
  if (toAsk) {
    return { outcome: "PENDING", criteria, fail_reasons: [], flags, ask: toAsk, next_question: QUESTIONS[toAsk] };
  }

  const stillUnclearActions = unclear.map((id) => config.unclearAfterQuestion[id]);
  const sqft = facts.sqft ?? parseSqft(facts.scope_text);
  const smallCommercial =
    isCommercial(facts) && sqft !== undefined && sqft < config.commercialMinSqft && config.commercialBelowMinAction === "needs_human";
  if (stillUnclearActions.includes("needs_human") || smallCommercial) {
    const promise = callback(config.callbackWithinMin);
    return {
      outcome: "NEEDS_HUMAN",
      criteria,
      fail_reasons: [],
      flags: [...flags, ...(smallCommercial ? ["small_commercial"] : []), ...unclear.map((id) => `unclear_${id}`)],
      say_line: NEEDS_HUMAN_LINE.replace("{when}", promise.words),
      callback_at: promise.at.toISOString(),
    };
  }

  const notes = [
    ...unclear.map((id) => `unclear_${id}`),
    ...(byId.C4.state === "unclear" ? ["unclear_C4"] : []),
    ...(byId.C5.state === "unclear" || byId.C5.state === "not_mentioned" ? ["unclear_C5"] : []),
  ];
  return {
    outcome: notes.length > 0 ? "QUALIFIED_WITH_NOTES" : "QUALIFIED",
    criteria,
    fail_reasons: [],
    flags: [...flags, ...notes],
    consult_type: consultType(facts, config),
  };
}
