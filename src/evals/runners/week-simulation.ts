// Eval week-simulation: a synthetic week of handoffs, callbacks and consultations driven through the
// follow-ups job on a fake clock in 2-minute steps. Every escalation must fire once, on time
// (within one tick of its deadline), and nothing may be sent twice.
import { type FollowupRepo, runFollowups } from "../../lib/followups/run";
import { defaultRulesConfig } from "../../lib/rules/config";
import { addOfficeMinutes } from "../../lib/rules/office-time";
import { fromIst } from "../../lib/rules/time";
import type { TelegramClient } from "../../lib/telegram/client";
import type { EvalRunner } from "../registry";
import { buildReport } from "../report";
import type { ItemResult } from "../types";

type Handoff = { id: string; enquiryId: string; postedAt: Date; acceptAt: Date | null; remindedAt: Date | null; escalatedAt: Date | null };
type Callback = { id: string; dueAt: Date; doneAt: Date | null; escalatedAt: Date | null };

export const weekSimulation: EvalRunner = async ({ budget }) => {
  const startedAt = new Date();
  const rules = defaultRulesConfig();
  const values = { accept_reminder_min: 15, accept_escalate_min: 30, outcome_nudge_max: 3, dropped_call_callback_min: 5 };
  const start = fromIst(2026, 10, 12, 0, 0); // Monday
  const end = fromIst(2026, 10, 19, 0, 0);

  // 60 calls spread across the week at all hours; random accept delays (some never accepted).
  let seed = 7;
  const rand = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
  const handoffs: Handoff[] = [];
  const callbacks: Callback[] = [];
  for (let i = 0; i < 60; i += 1) {
    const postedAt = new Date(start.getTime() + rand() * (end.getTime() - start.getTime() - 86_400_000));
    const delay = rand();
    const acceptAt = delay < 0.25 ? null : addOfficeMinutes(postedAt, Math.round(5 + delay * 60), rules.office);
    handoffs.push({ id: `h${i}`, enquiryId: `e${i}`, postedAt, acceptAt, remindedAt: null, escalatedAt: null });
    if (i % 3 === 0) callbacks.push({ id: `c${i}`, dueAt: addOfficeMinutes(postedAt, 30, rules.office), doneAt: rand() < 0.5 ? addOfficeMinutes(postedAt, 20, rules.office) : null, escalatedAt: null });
  }

  let now = start;
  const sends: { at: Date; html: string }[] = [];
  const telegram: TelegramClient = {
    async send(message) {
      sends.push({ at: now, html: message.html });
      return { messageId: sends.length };
    },
    edit: async () => {},
    answer: async () => {},
  };
  const accepted = (h: Handoff) => h.acceptAt !== null && h.acceptAt.getTime() <= now.getTime();
  const repo: FollowupRepo = {
    handoffsWaiting: async () => handoffs.filter((h) => !accepted(h) && !h.escalatedAt).map((h) => ({ ...h, callerName: h.id, designerName: "Designer" })),
    claimHandoff: async (id, field, at) => {
      const h = handoffs.find((row) => row.id === id)!;
      if (h[field]) return false;
      h[field] = at;
      return true;
    },
    releaseHandoff: async (id, field) => void (handoffs.find((row) => row.id === id)![field] = null),
    callbacksWaiting: async () => callbacks.filter((c) => !(c.doneAt && c.doneAt <= now) && !c.escalatedAt).map((c) => ({ id: c.id, kind: "callback", dueAt: c.dueAt, escalatedAt: c.escalatedAt, reason: "callback", callerName: c.id, phone: null })),
    claimTaskEscalation: async (id, at) => {
      const c = callbacks.find((row) => row.id === id)!;
      if (c.escalatedAt) return false;
      c.escalatedAt = at;
      return true;
    },
    releaseTaskEscalation: async (id) => void (callbacks.find((row) => row.id === id)!.escalatedAt = null),
    consultsWaiting: async () => [],
    claimNudge: async () => false,
    releaseNudge: async () => {},
    nurturesWaiting: async () => [],
    createNurtureTask: async () => false,
    droppedCalls: async () => [],
    claimCallback: async () => false,
    createTask: async () => {},
  };
  const chats = { designers: -1, front_desk: -2, founder: -3 };
  for (; now.getTime() < end.getTime(); now = new Date(now.getTime() + 120_000)) {
    // Two overlapping runs each tick, to prove claims hold.
    await Promise.all([runFollowups({ repo, telegram, chats, rules, values, now: () => now }), runFollowups({ repo, telegram, chats, rules, values, now: () => now })]);
  }

  const items: ItemResult[] = [];
  let missed = 0;
  let late = 0;
  let duplicates = 0;
  for (const h of handoffs) {
    const deadline = addOfficeMinutes(h.postedAt, 30, rules.office);
    // Only deadlines inside the simulated window can be judged.
    const shouldEscalate = (!h.acceptAt || h.acceptAt.getTime() > deadline.getTime()) && deadline.getTime() < end.getTime() - 120_000;
    const escalationSends = sends.filter((s) => s.html.includes("Escalation") && s.html.includes(`for ${h.id} `)).length;
    const isMissed = shouldEscalate && !h.escalatedAt;
    const isLate = Boolean(h.escalatedAt) && h.escalatedAt!.getTime() - deadline.getTime() > 120_000;
    const extra = Math.max(0, escalationSends - 2); // one escalation goes to two chats
    const wrong = Boolean(h.escalatedAt) && h.acceptAt !== null && h.acceptAt.getTime() <= deadline.getTime();
    missed += isMissed ? 1 : 0;
    late += isLate ? 1 : 0;
    duplicates += extra + (wrong ? 1 : 0);
    items.push({ item_id: h.id, expected: shouldEscalate ? `escalate by ${deadline.toISOString()}` : "no escalation", actual: h.escalatedAt?.toISOString() ?? "none", scores: { missed: isMissed, late: isLate, extra }, passed: !isMissed && !isLate && extra === 0 && !wrong });
  }
  for (const c of callbacks) {
    const shouldEscalate = (!c.doneAt || c.doneAt.getTime() > c.dueAt.getTime()) && c.dueAt.getTime() < end.getTime() - 120_000;
    const isMissed = shouldEscalate && !c.escalatedAt;
    missed += isMissed ? 1 : 0;
    items.push({ item_id: c.id, expected: shouldEscalate ? "escalate" : "none", actual: c.escalatedAt?.toISOString() ?? "none", scores: { missed: isMissed }, passed: !isMissed });
  }
  const shouldCount = items.filter((item) => String(item.expected).startsWith("escalate")).length;

  return buildReport({
    evalName: "week-simulation",
    datasetVersion: "synthetic-week-seed-7",
    startedAt,
    metrics: { handoffs: handoffs.length, callbacks: callbacks.length, ticks: (end.getTime() - start.getTime()) / 120_000, escalations_expected: shouldCount, missed, late, duplicates, on_time_rate: shouldCount ? (shouldCount - missed - late) / shouldCount : 1 },
    thresholds: [
      { metric: "missed", op: "==", value: 0, hard: true },
      { metric: "duplicates", op: "==", value: 0, hard: true },
      { metric: "on_time_rate", op: "==", value: 1 },
    ],
    items,
    costInr: budget.spentInr,
  });
};
