// Posts queued handoffs and tasks to the staff chats configured in settings. It never sends to
// any other chat, and a row is marked posted only after Telegram accepts the message.
import type { TelegramClient } from "./client";
import { type HandoffView, handoffMessage, type TaskView, taskMessage } from "./templates";

export type StaffChats = { designers: number | null; front_desk: number | null; founder: number | null };

export interface DispatchRepo {
  pendingHandoffs(limit: number): Promise<HandoffView[]>;
  markHandoffPosted(handoffId: string, chatId: number, messageId: number): Promise<void>;
  pendingTasks(limit: number): Promise<TaskView[]>;
  markTaskPosted(taskId: string, chatId: number, messageId: number): Promise<void>;
}

const FOUNDER_KINDS = new Set(["urgent", "alert"]);

export function chatsForTask(kind: string, chats: StaffChats): number[] {
  const targets = FOUNDER_KINDS.has(kind) ? [chats.founder, chats.front_desk] : [chats.front_desk];
  return [...new Set(targets.filter((chat): chat is number => typeof chat === "number"))];
}

export async function dispatchPending(deps: { repo: DispatchRepo; telegram: TelegramClient; chats: StaffChats }): Promise<{ handoffs: number; tasks: number; skipped: string[] }> {
  const skipped: string[] = [];
  let handoffs = 0;
  let tasks = 0;

  if (deps.chats.designers === null) skipped.push("no designers chat configured");
  else {
    for (const view of await deps.repo.pendingHandoffs(20)) {
      const { html, buttons } = handoffMessage(view);
      const sent = await deps.telegram.send({ chatId: deps.chats.designers, html, buttons });
      await deps.repo.markHandoffPosted(view.handoffId, deps.chats.designers, sent.messageId);
      handoffs += 1;
    }
  }

  for (const view of await deps.repo.pendingTasks(20)) {
    const targets = chatsForTask(view.kind, deps.chats);
    if (targets.length === 0) {
      skipped.push(`no chat for ${view.kind}`);
      continue;
    }
    const { html, buttons } = taskMessage(view);
    let first: { chatId: number; messageId: number } | undefined;
    for (const chatId of targets) {
      const sent = await deps.telegram.send({ chatId, html, buttons });
      first ??= { chatId, messageId: sent.messageId };
    }
    await deps.repo.markTaskPosted(view.taskId, first!.chatId, first!.messageId);
    tasks += 1;
  }
  return { handoffs, tasks, skipped };
}
