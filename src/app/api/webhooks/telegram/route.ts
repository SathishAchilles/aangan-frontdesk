import { after, NextResponse } from "next/server";
import { db } from "@/db/client";
import { secretMatches } from "@/lib/http/auth";
import { createInboxStore } from "@/lib/inbox/store";
import { type CallbackQuery, handleCallbackQuery } from "@/lib/telegram/actions";
import { createTelegramClient } from "@/lib/telegram/client";
import { createTelegramActionRepo } from "@/lib/telegram/repo";

export const dynamic = "force-dynamic";

// Telegram sends the secret token chosen at setWebhook time in this header.
export async function POST(request: Request) {
  if (!secretMatches(request.headers.get("x-telegram-bot-api-secret-token"), process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const update = (await request.json().catch(() => null)) as { update_id?: number; callback_query?: CallbackQuery } | null;
  if (!update?.update_id || !update.callback_query) return NextResponse.json({ ok: true });
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: true, skipped: "no bot token" });

  const store = createInboxStore(db);
  const inboxId = await store.insert("telegram", String(update.update_id), update);
  if (inboxId === null) return NextResponse.json({ ok: true, duplicate: true });
  const query = update.callback_query;

  after(async () => {
    try {
      await handleCallbackQuery(query, { repo: createTelegramActionRepo(db), telegram: createTelegramClient(token), now: () => new Date() });
      await store.markProcessed(inboxId);
    } catch (error) {
      await store.markFailed(inboxId, error instanceof Error ? error.message : "unknown error");
    }
  });
  return NextResponse.json({ ok: true });
}
