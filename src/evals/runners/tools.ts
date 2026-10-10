// Eval tool-latency: replays realistic tool requests against a deployed app and measures p95.
// Eval tool-leakage: 500 generated fact sets through the evaluate handler; nothing spoken may
// contain a cost figure.
import postgres from "postgres";
import { defaultRulesConfig } from "../../lib/rules/config";
import { fromIst } from "../../lib/rules/time";
import { evaluateEnquiry } from "../../lib/tools/handlers";
import type { CallerRecord, EnquiryRecord, ToolRepo } from "../../lib/tools/types";
import { containsPriceFigure } from "../graders/deterministic";
import type { EvalRunner } from "../registry";
import { buildReport } from "../report";
import type { ItemResult } from "../types";

// Test callers use this reserved prefix and are deleted after the run.
const TEST_PREFIX = "+9199999";

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

const FACT_SETS = [
  {},
  { locality: "Kothrud", scope_text: "full 3BHK redesign", execution: "yes" },
  { locality: "Nashik", scope_text: "home office" },
  { scope_text: "restaurant interiors", segment: "restaurant" },
  { deadline_text: "in 3 weeks", locality: "Baner", execution: "yes" },
  { budget_text: "1.5 lakh", rooms: ["kitchen", "bedroom"], full_home: false, locality: "Aundh", execution: "yes" },
];

export const toolLatency: EvalRunner = async ({ budget, args }) => {
  const startedAt = new Date();
  const base = String(args.url ?? process.env.APP_URL ?? "https://aangan-frontdesk.vercel.app").replace(/\/$/, "");
  const key = process.env.TOOL_SECRET;
  if (!key) throw new Error("TOOL_SECRET is not set");
  const total = Number(args.requests ?? 200);
  const timings: number[] = [];
  const items: ItemResult[] = [];
  let serverErrors = 0;

  for (let i = 0; i < total; i += 1) {
    const phone = `${TEST_PREFIX}${String(i % 40).padStart(5, "0")}`;
    const isLookup = i % 3 === 0;
    const path = isLookup ? "lookup-caller" : "evaluate-enquiry";
    // Same shape as Vaani: fact fields at the top level.
    const body = isLookup ? { phone } : { phone, ...FACT_SETS[i % FACT_SETS.length], asked: i % 2 ? ["C1"] : [] };
    const started = performance.now();
    const response = await fetch(`${base}/api/vaani/tools/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tool-key": key },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    const ms = performance.now() - started;
    timings.push(ms);
    // The routes answer Vaani with 200 even on failure; a crash shows as error "internal".
    const failed = response.status >= 500 || /"error":"internal"/.test(text);
    if (failed) serverErrors += 1;
    items.push({
      item_id: `${path}#${i}`,
      expected: "2xx under 1500 ms",
      actual: { status: response.status, ms: Math.round(ms) },
      scores: { ms: Math.round(ms), status: response.status },
      passed: !failed && ms < 1500,
    });
  }

  // Remove the test callers and their enquiries.
  const url = process.env.DATABASE_MIGRATION_URL;
  if (url) {
    const sql = postgres(url, { max: 1, onnotice: () => {} });
    try {
      await sql`delete from aangan.enquiries where caller_id in (select id from aangan.callers where phone_e164 like ${`${TEST_PREFIX}%`})`;
      await sql`delete from aangan.callers where phone_e164 like ${`${TEST_PREFIX}%`}`;
    } finally {
      await sql.end();
    }
  }

  return buildReport({
    evalName: "tool-latency",
    datasetVersion: `replay-${total}`,
    startedAt,
    metrics: {
      requests: total,
      p50_ms: Math.round(percentile(timings, 50)),
      p95_ms: Math.round(percentile(timings, 95)),
      max_ms: Math.round(Math.max(...timings)),
      server_errors: serverErrors,
    },
    thresholds: [
      { metric: "p95_ms", op: "<=", value: 1500 },
      { metric: "server_errors", op: "==", value: 0, hard: true },
    ],
    items,
    costInr: budget.spentInr,
  });
};

function memoryRepo(): ToolRepo {
  const callers = new Map<string, CallerRecord>();
  const enquiries = new Map<string, EnquiryRecord>();
  let id = 0;
  return {
    async findCallerByPhone(phone) {
      return callers.get(phone) ?? null;
    },
    async upsertCaller(phone) {
      const caller = callers.get(phone) ?? { id: `c${(id += 1)}`, phoneE164: phone, name: null };
      callers.set(phone, caller);
      return caller;
    },
    async latestEnquiry() {
      return null;
    },
    async getEnquiry(enquiryId) {
      return enquiries.get(enquiryId) ?? null;
    },
    async createEnquiry(callerId, intent) {
      const enquiry: EnquiryRecord = { id: `e${(id += 1)}`, callerId, intent, outcome: "PENDING", facts: {}, asked: [], createdAt: new Date() };
      enquiries.set(enquiry.id, enquiry);
      return enquiry;
    },
    async saveEvaluation() {},
    async createTask() {
      return { id: `t${(id += 1)}` };
    },
  };
}

export const toolLeakage: EvalRunner = async ({ budget, args }) => {
  const startedAt = new Date();
  const total = Number(args.cases ?? 500);
  let state = 1234;
  const next = () => (state = (state * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
  const pick = <T,>(values: readonly T[]) => values[Math.floor(next() * values.length)];
  const deps = { repo: memoryRepo(), now: () => fromIst(2026, 10, 13, next() > 0.5 ? 14 : 23), settings: async () => ({ rules: defaultRulesConfig(), version: 1 }) };

  const items: ItemResult[] = [];
  for (let i = 0; i < total; i += 1) {
    const facts = {
      project_type: pick(["residential", "commercial", "unknown"] as const),
      scope_text: pick(["kitchen", "full home", "just ideas", "gym", "office fitout", "", "villa interiors", "2 bedrooms"]),
      rooms: next() > 0.5 ? ["kitchen", "bedroom"] : undefined,
      full_home: next() > 0.5,
      sqft: next() > 0.3 ? Math.round(80 + next() * 7000) : undefined,
      locality: pick(["Kothrud", "Nashik", "", "Baner", "Talegaon", "unknown place"]),
      deadline_text: pick(["in 2 weeks", "by March", "", "asap", "before Diwali", "January start"]),
      budget_text: pick(["1 lakh", "₹2-3 lakh", "50 lakh", "2 crore", "", "reasonable", "Rs 90000", "80k"]),
      decision_text: pick(["owner", "for my parents", ""]),
      wants_human: next() > 0.92,
    };
    const response = await evaluateEnquiry(
      { phone: `+9199998${String(i).padStart(5, "0")}`, intent: pick(["new", "new", "existing", "other"] as const), facts, asked: pick([[], ["C1", "C2", "C3"]]) },
      deps,
    );
    const spoken = [response.body.say_line, response.body.next_question].filter(Boolean).map(String);
    const leaked = spoken.filter(containsPriceFigure);
    items.push({
      item_id: `case-${i}`,
      expected: "no cost figure",
      actual: { outcome: response.body.outcome, leaked },
      scores: { leaked: leaked.length },
      passed: leaked.length === 0,
    });
  }

  return buildReport({
    evalName: "tool-leakage",
    datasetVersion: `fuzz-${total}-seed-1234`,
    startedAt,
    metrics: { cases: total, price_leakage: items.filter((item) => !item.passed).length },
    thresholds: [{ metric: "price_leakage", op: "==", value: 0, hard: true }],
    items,
    costInr: budget.spentInr,
  });
};
