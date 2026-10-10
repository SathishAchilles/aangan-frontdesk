// Button presses from staff. First press wins; anyone not on the staff list is ignored.
import type { TelegramClient } from "./client";
import { acceptedFooter, esc, outcomeButtons, parseCallbackData } from "./templates";

export type CallbackQuery = {
  id: string;
  from: { id: number; first_name?: string };
  data?: string;
  message?: { message_id: number; chat: { id: number }; text?: string };
};

export interface TelegramActionRepo {
  staffByTelegramId(telegramUserId: number): Promise<{ id: string; name: string; role: string } | null>;
  // Returns the accepting designer's name if this press won, or the existing accepter if not.
  acceptHandoff(handoffId: string, staffId: string): Promise<{ won: boolean; enquiryId: string | null; acceptedBy: string | null }>;
  completeTask(taskId: string, staffId: string): Promise<boolean>;
  recordResult(enquiryId: string, result: "won" | "lost", staffId: string): Promise<boolean>;
}

export type ActionResult = { action: string; ok: boolean; reason?: string };

function stamp(now: Date): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(11, 16);
}

export async function handleCallbackQuery(query: CallbackQuery, deps: { repo: TelegramActionRepo; telegram: TelegramClient; now: () => Date }): Promise<ActionResult> {
  const parsed = parseCallbackData(query.data ?? "");
  if (!parsed) {
    await deps.telegram.answer(query.id, "Unknown button");
    return { action: "unknown", ok: false, reason: "bad data" };
  }
  const staff = await deps.repo.staffByTelegramId(query.from.id);
  if (!staff) {
    await deps.telegram.answer(query.id, "Only Aangan staff can use these buttons.");
    return { action: parsed.action, ok: false, reason: "not staff" };
  }
  const message = query.message;
  const html = message?.text ? esc(message.text) : "";

  switch (parsed.action) {
    case "acc": {
      const result = await deps.repo.acceptHandoff(parsed.id, staff.id);
      if (!result.won) {
        await deps.telegram.answer(query.id, `Already accepted by ${result.acceptedBy ?? "someone else"}.`);
        return { action: "acc", ok: false, reason: "already accepted" };
      }
      if (message && result.enquiryId) {
        await deps.telegram.edit(message.chat.id, message.message_id, acceptedFooter(html, staff.name, stamp(deps.now())), outcomeButtons(result.enquiryId));
      }
      await deps.telegram.answer(query.id, "Accepted. It's yours.");
      return { action: "acc", ok: true };
    }
    case "done": {
      const done = await deps.repo.completeTask(parsed.id, staff.id);
      if (message && done) await deps.telegram.edit(message.chat.id, message.message_id, `${html}\n\n✅ <b>Done by ${esc(staff.name)}</b> at ${stamp(deps.now())}`);
      await deps.telegram.answer(query.id, done ? "Marked done." : "Already done.");
      return { action: "done", ok: done };
    }
    case "won":
    case "lost": {
      const saved = await deps.repo.recordResult(parsed.id, parsed.action, staff.id);
      if (message && saved) await deps.telegram.edit(message.chat.id, message.message_id, `${html}\n\n${parsed.action === "won" ? "🏆 <b>Won</b>" : "➖ <b>Lost</b>"} · recorded by ${esc(staff.name)}`);
      await deps.telegram.answer(query.id, saved ? "Recorded." : "Already recorded.");
      return { action: parsed.action, ok: saved };
    }
  }
}
