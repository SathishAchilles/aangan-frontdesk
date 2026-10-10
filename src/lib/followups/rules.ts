// When each follow-up is due. Pure functions of the row's timestamps, "now" and settings,
// so a fake clock can drive them through a whole simulated week.
import { addOfficeMinutes, nextOfficeOpen, type OfficeConfig, officeMinutesBetween } from "../rules/office-time";
import { fromIst, istParts } from "../rules/time";

export type AcceptanceAction = "remind" | "escalate" | null;

export function acceptanceAction(
  row: { postedAt: Date; remindedAt: Date | null; escalatedAt: Date | null },
  now: Date,
  office: OfficeConfig,
  reminderMin: number,
  escalateMin: number,
): AcceptanceAction {
  const waited = officeMinutesBetween(row.postedAt, now, office);
  if (!row.escalatedAt && waited >= escalateMin) return "escalate";
  if (!row.remindedAt && !row.escalatedAt && waited >= reminderMin) return "remind";
  return null;
}

export function callbackOverdue(row: { dueAt: Date | null; escalatedAt: Date | null }, now: Date): boolean {
  return row.dueAt !== null && row.escalatedAt === null && now.getTime() > row.dueAt.getTime();
}

// Nudge from 10:00 on the first working day after the consultation, at most once per day and
// at most `max` times.
export function outcomeNudgeDue(
  row: { startAt: Date; nudges: number; lastNudgeAt: Date | null; hasResult: boolean },
  now: Date,
  office: OfficeConfig,
  max: number,
): boolean {
  if (row.hasResult || row.nudges >= max) return false;
  const p = istParts(row.startAt);
  const firstDue = nextOfficeOpen(fromIst(p.year, p.month, p.day + 1, 0, 0), office);
  if (now.getTime() < firstDue.getTime()) return false;
  if (!row.lastNudgeAt) return true;
  const last = istParts(row.lastNudgeAt);
  const today = istParts(now);
  return !(last.year === today.year && last.month === today.month && last.day === today.day);
}

export function nurtureDue(row: { nurtureDueAt: Date | null; hasTask: boolean }, now: Date): boolean {
  return row.nurtureDueAt !== null && !row.hasTask && now.getTime() >= row.nurtureDueAt.getTime();
}

// Call back a dropped new enquiry once, a few minutes after it dropped, unless the caller rang again.
export function droppedCallbackDue(
  row: { endedAt: Date | null; callbackPlacedAt: Date | null; redialled: boolean },
  now: Date,
  afterMin: number,
): boolean {
  if (!row.endedAt || row.callbackPlacedAt || row.redialled) return false;
  return now.getTime() - row.endedAt.getTime() >= afterMin * 60_000;
}

export function escalationDeadline(postedAt: Date, office: OfficeConfig, minutes: number): Date {
  return addOfficeMinutes(postedAt, minutes, office);
}
