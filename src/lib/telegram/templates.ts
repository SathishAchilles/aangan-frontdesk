// Telegram message templates (HTML parse mode). Full phone numbers appear only here, in staff
// chats; dashboards and logs mask them.
import type { CriterionResult } from "../rules/facts";
import type { InlineButton } from "./client";

export function esc(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const STATE_MARK: Record<string, string> = { pass: "✅", fail: "❌", unclear: "❓", not_mentioned: "➖" };
const CRITERION_NAME: Record<string, string> = { C1: "Real project", C2: "Service area", C3: "Timeline", C4: "Budget", C5: "Decision-maker" };
const CONSULT: Record<string, string> = { studio: "Studio consultation", site: "Site visit", principal: "Principal designer visit" };
const FLAG_TEXT: Record<string, string> = {
  referral: "Referral",
  frustrated: "Caller was frustrated - handle with care",
  tight_timeline: "Tight timeline",
  repeat_caller: "Has called before",
  unclear_C1: "Execution not confirmed",
  unclear_C3: "Timeline not confirmed",
  unclear_C4: "Budget unclear for the scope",
  unclear_C5: "Decision-maker not confirmed",
};

export type HandoffView = {
  handoffId: string;
  enquiryId: string;
  outcome: string;
  callerName: string | null;
  phone: string;
  slotLabel: string | null;
  consultType: string | null;
  designerName: string | null;
  designerTelegramId: number | null;
  note: Record<string, unknown> | null;
  criteria: CriterionResult[];
  flags: string[];
  callUrl: string | null;
};

export function handoffMessage(view: HandoffView): { html: string; buttons: InlineButton[][] } {
  const note = view.note ?? {};
  const mention = view.designerTelegramId
    ? `<a href="tg://user?id=${view.designerTelegramId}">${esc(view.designerName)}</a>`
    : esc(view.designerName ?? "unassigned");
  const lines = [
    `<b>New enquiry · ${view.outcome === "QUALIFIED" ? "Qualified" : "Qualified (with notes)"}</b>`,
    `<b>${esc(view.callerName ?? note.client_name ?? "Caller")}</b> · ${esc(view.phone)}`,
    view.slotLabel ? `📅 ${esc(view.slotLabel)} · ${esc(CONSULT[view.consultType ?? "studio"] ?? "Consultation")}` : "📅 Not booked yet",
    `👤 Assigned: ${mention}`,
    "",
    note.one_line_summary ? `<i>${esc(note.one_line_summary)}</i>` : "",
    ...[
      ["Area", note.area],
      ["Property", note.property],
      ["Size", note.size_sqft ? `${note.size_sqft} sq ft` : null],
      ["Scope", note.scope],
      ["Timeline", note.timeline],
      ["Decides", note.decision_maker],
      ["Budget (their words)", note.budget_mentioned],
      ["Likes", note.style_or_preferences],
      ["Referred by", note.referral],
    ]
      .filter(([, value]) => value)
      .map(([label, value]) => `<b>${esc(label)}:</b> ${esc(value)}`),
    "",
    "<b>Checks</b>",
    ...view.criteria.map((criterion) => `${STATE_MARK[criterion.state] ?? "•"} ${CRITERION_NAME[criterion.id]}${criterion.evidence ? ` - “${esc(criterion.evidence.slice(0, 90))}”` : ""}`),
  ];
  const flags = view.flags.map((flag) => FLAG_TEXT[flag]).filter(Boolean);
  if (flags.length > 0) lines.push("", `⚠️ ${flags.map(esc).join(" · ")}`);
  if (view.callUrl) lines.push("", `<a href="${esc(view.callUrl)}">Transcript and recording</a>`);
  return { html: lines.filter((line, index, all) => !(line === "" && all[index - 1] === "")).join("\n"), buttons: [[{ text: "Accept", callback_data: `acc:${view.handoffId}` }]] };
}

export function acceptedFooter(html: string, designerName: string, at: string): string {
  return `${html}\n\n✅ <b>Accepted by ${esc(designerName)}</b> at ${esc(at)}`;
}

export function outcomeButtons(enquiryId: string): InlineButton[][] {
  return [[{ text: "Won", callback_data: `won:${enquiryId}` }, { text: "Lost", callback_data: `lost:${enquiryId}` }]];
}

const TASK_TITLE: Record<string, string> = {
  callback: "📞 Call back",
  rebook: "🔁 Rebook consultation",
  review: "🔍 Review needed",
  nurture: "🌱 Nurture follow-up",
  urgent: "🚨 Urgent: existing client",
  message: "✉️ Message",
  alert: "🚨 Safety alert",
};

export type TaskView = { taskId: string; kind: string; reason: string; phone: string | null; callerName: string | null; dueLabel: string | null; summary: string | null; callUrl: string | null };

export function taskMessage(view: TaskView): { html: string; buttons: InlineButton[][] } {
  const lines = [
    `<b>${TASK_TITLE[view.kind] ?? "Task"}</b>`,
    esc(view.reason),
    view.callerName || view.phone ? `${esc(view.callerName ?? "Caller")}${view.phone ? ` · ${esc(view.phone)}` : ""}` : "",
    view.summary ? `<i>${esc(view.summary)}</i>` : "",
    view.dueLabel ? `⏰ Promised: ${esc(view.dueLabel)}` : "",
    view.callUrl ? `<a href="${esc(view.callUrl)}">Call details</a>` : "",
  ].filter(Boolean);
  return { html: lines.join("\n"), buttons: [[{ text: "Done", callback_data: `done:${view.taskId}` }]] };
}

export function reminderMessage(kind: "reminder" | "escalation", what: string, minutes: number, who: string | null): string {
  return kind === "reminder"
    ? `⏰ <b>Reminder:</b> ${esc(what)} has not been accepted for ${minutes} minutes${who ? ` (${esc(who)})` : ""}.`
    : `🚨 <b>Escalation:</b> ${esc(what)} is still not accepted after ${minutes} minutes${who ? ` - assigned to ${esc(who)}` : ""}. Please reassign or call the client.`;
}

export type QualitySummary = { week: string; sampled: number; outcomeRate: number; hardZeroHits: number; failingLinks: string[] };

export function qualitySummaryMessage(summary: QualitySummary): string {
  return [
    `<b>Weekly call quality · ${esc(summary.week)}</b>`,
    `${summary.sampled} calls sampled · correct outcome ${(summary.outcomeRate * 100).toFixed(0)}%`,
    summary.hardZeroHits > 0 ? `🚨 ${summary.hardZeroHits} safety issue(s) found` : "✅ No safety issues",
    ...summary.failingLinks.slice(0, 5).map((link) => `• <a href="${esc(link)}">${esc(link)}</a>`),
  ].join("\n");
}

// Buttons carry short prefixes plus a UUID: well under Telegram's 64-byte callback_data limit.
export function parseCallbackData(data: string): { action: "acc" | "done" | "won" | "lost"; id: string } | null {
  const match = data.match(/^(acc|done|won|lost):([0-9a-f-]{36})$/);
  return match ? { action: match[1] as "acc" | "done" | "won" | "lost", id: match[2] } : null;
}
