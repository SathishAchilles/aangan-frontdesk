// One pass of the follow-ups job. Every action is claimed first with a conditional update, so two
// overlapping runs never send the same reminder twice; a failed send releases its claim.
import type { RulesConfig } from "../rules/config";
import type { TelegramClient } from "../telegram/client";
import type { StaffChats } from "../telegram/dispatch";
import { reminderMessage } from "../telegram/templates";
import { acceptanceAction, callbackOverdue, droppedCallbackDue, nurtureDue, outcomeNudgeDue } from "./rules";

export type HandoffWaiting = { id: string; enquiryId: string; postedAt: Date; remindedAt: Date | null; escalatedAt: Date | null; callerName: string | null; designerName: string | null };
export type CallbackWaiting = { id: string; dueAt: Date | null; escalatedAt: Date | null; reason: string; callerName: string | null; phone: string | null };
export type ConsultWaiting = { enquiryId: string; startAt: Date; nudges: number; lastNudgeAt: Date | null; hasResult: boolean; callerName: string | null; designerName: string | null };
export type NurtureWaiting = { enquiryId: string; nurtureDueAt: Date | null; hasTask: boolean; callerName: string | null };
export type DroppedCall = { callId: string; enquiryId: string | null; endedAt: Date | null; callbackPlacedAt: Date | null; redialled: boolean; phone: string | null; callerName: string | null };

export interface FollowupRepo {
  handoffsWaiting(): Promise<HandoffWaiting[]>;
  claimHandoff(id: string, field: "remindedAt" | "escalatedAt", now: Date): Promise<boolean>;
  releaseHandoff(id: string, field: "remindedAt" | "escalatedAt"): Promise<void>;
  callbacksWaiting(): Promise<CallbackWaiting[]>;
  claimTaskEscalation(id: string, now: Date): Promise<boolean>;
  releaseTaskEscalation(id: string): Promise<void>;
  consultsWaiting(): Promise<ConsultWaiting[]>;
  claimNudge(enquiryId: string, expectedNudges: number, now: Date): Promise<boolean>;
  releaseNudge(enquiryId: string, previous: { nudges: number; lastNudgeAt: Date | null }): Promise<void>;
  nurturesWaiting(): Promise<NurtureWaiting[]>;
  createNurtureTask(enquiryId: string, reason: string): Promise<boolean>;
  droppedCalls(): Promise<DroppedCall[]>;
  claimCallback(callId: string, now: Date): Promise<boolean>;
  createTask(task: { enquiryId: string | null; kind: "callback" | "alert"; reason: string; payload: Record<string, unknown>; dueAt?: Date }): Promise<void>;
}

export type FollowupDeps = {
  repo: FollowupRepo;
  telegram: TelegramClient | null;
  chats: StaffChats;
  rules: RulesConfig;
  values: Record<string, unknown>;
  now: () => Date;
  // Places an outbound callback; returns false when no voice agent or number is configured.
  placeCallback?: (call: DroppedCall) => Promise<boolean>;
};

export type FollowupSummary = Record<string, number>;

async function sendTo(deps: FollowupDeps, chats: (number | null)[], html: string, buttons?: { text: string; callback_data: string }[][]): Promise<boolean> {
  if (!deps.telegram) return false;
  const targets = [...new Set(chats.filter((chat): chat is number => typeof chat === "number"))];
  if (targets.length === 0) return false;
  for (const chatId of targets) await deps.telegram.send({ chatId, html, buttons });
  return true;
}

export async function runFollowups(deps: FollowupDeps): Promise<FollowupSummary> {
  const now = deps.now();
  const summary: FollowupSummary = { reminders: 0, escalations: 0, callback_escalations: 0, nudges: 0, nurture_tasks: 0, callbacks_placed: 0, callback_tasks: 0 };
  const reminderMin = Number(deps.values.accept_reminder_min ?? 15);
  const escalateMin = Number(deps.values.accept_escalate_min ?? 30);

  for (const handoff of await deps.repo.handoffsWaiting()) {
    const action = acceptanceAction(handoff, now, deps.rules.office, reminderMin, escalateMin);
    if (!action) continue;
    const field = action === "remind" ? "remindedAt" : "escalatedAt";
    if (!(await deps.repo.claimHandoff(handoff.id, field, now))) continue;
    const what = `Handoff for ${handoff.callerName ?? "a new enquiry"}`;
    try {
      const sent =
        action === "remind"
          ? await sendTo(deps, [deps.chats.designers], reminderMessage("reminder", what, reminderMin, handoff.designerName))
          : await sendTo(deps, [deps.chats.front_desk, deps.chats.founder], reminderMessage("escalation", what, escalateMin, handoff.designerName));
      if (!sent) await deps.repo.releaseHandoff(handoff.id, field);
      else summary[action === "remind" ? "reminders" : "escalations"] += 1;
    } catch (error) {
      await deps.repo.releaseHandoff(handoff.id, field);
      throw error;
    }
  }

  for (const task of await deps.repo.callbacksWaiting()) {
    if (!callbackOverdue(task, now) || !(await deps.repo.claimTaskEscalation(task.id, now))) continue;
    const sent = await sendTo(deps, [deps.chats.founder], `🚨 <b>Callback overdue:</b> ${task.callerName ?? "caller"}${task.phone ? ` (${task.phone})` : ""} - ${task.reason}`).catch(() => false);
    if (sent) summary.callback_escalations += 1;
    else await deps.repo.releaseTaskEscalation(task.id);
  }

  const maxNudges = Number(deps.values.outcome_nudge_max ?? 3);
  for (const consult of await deps.repo.consultsWaiting()) {
    if (!outcomeNudgeDue(consult, now, deps.rules.office, maxNudges)) continue;
    if (!(await deps.repo.claimNudge(consult.enquiryId, consult.nudges, now))) continue;
    const html = `📝 <b>How did the consultation go?</b> ${consult.callerName ?? "Client"}${consult.designerName ? ` · ${consult.designerName}` : ""}`;
    const sent = await sendTo(deps, [deps.chats.designers], html, [[{ text: "Won", callback_data: `won:${consult.enquiryId}` }, { text: "Lost", callback_data: `lost:${consult.enquiryId}` }]]).catch(() => false);
    if (sent) summary.nudges += 1;
    else await deps.repo.releaseNudge(consult.enquiryId, { nudges: consult.nudges, lastNudgeAt: consult.lastNudgeAt });
  }

  for (const nurture of await deps.repo.nurturesWaiting()) {
    if (!nurtureDue(nurture, now)) continue;
    if (await deps.repo.createNurtureTask(nurture.enquiryId, `Nurture: call ${nurture.callerName ?? "the caller"} back about a later start`)) summary.nurture_tasks += 1;
  }

  const afterMin = Number(deps.values.dropped_call_callback_min ?? 5);
  for (const call of await deps.repo.droppedCalls()) {
    if (!droppedCallbackDue(call, now, afterMin) || !(await deps.repo.claimCallback(call.callId, now))) continue;
    const placed = deps.placeCallback ? await deps.placeCallback(call).catch(() => false) : false;
    if (placed) summary.callbacks_placed += 1;
    else {
      await deps.repo.createTask({ enquiryId: call.enquiryId, kind: "callback", reason: "Call dropped before the enquiry was finished", payload: { call_id: call.callId, phone: call.phone }, dueAt: now });
      summary.callback_tasks += 1;
    }
  }
  return summary;
}
