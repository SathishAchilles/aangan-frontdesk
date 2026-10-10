"use server";

// Accept and Won/Lost from the designer area. Each action takes the designer from the session, never
// from the form; an admin viewing as a designer is refused by requireActingDesigner (403).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, rawSql } from "@/db/client";
import { SCHEMA_NAME } from "@/db/schema";
import { requireActingDesigner } from "@/lib/designer/access";
import { acceptOnWeb, recordResultOnWeb, type WebActionDeps } from "@/lib/designer/web-actions";
import { createTelegramClient } from "@/lib/telegram/client";

function deps(): WebActionDeps {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  return {
    db,
    sql: rawSql(),
    schema: SCHEMA_NAME,
    telegram: token ? createTelegramClient(token) : null,
    appUrl: process.env.APP_URL ?? "https://aangan-frontdesk.vercel.app",
    now: () => new Date(),
  };
}

// Back to the page the button was on, with a one-word note for the banner. Only designer pages.
function back(formData: FormData, notice: string, extra: Record<string, string> = {}): string {
  const raw = String(formData.get("back") ?? "");
  const path = /^\/designer(?:\/[\w/-]*)?$/.test(raw) ? raw : "/designer";
  const query = new URLSearchParams({ done: notice, ...extra });
  return `${path}?${query.toString()}`;
}

export async function acceptHandoffAction(formData: FormData) {
  const designer = await requireActingDesigner();
  const outcome = await acceptOnWeb(deps(), designer, String(formData.get("handoff") ?? ""));
  revalidatePath("/designer", "layout");
  if (outcome.ok) redirect(back(formData, outcome.telegramUpdated ? "accepted-telegram" : "accepted"));
  if (outcome.reason === "taken") redirect(back(formData, "taken", outcome.acceptedBy ? { by: outcome.acceptedBy } : {}));
  redirect(back(formData, "not-allowed"));
}

export async function recordResultAction(formData: FormData) {
  const designer = await requireActingDesigner();
  const result = formData.get("result") === "won" ? "won" : formData.get("result") === "lost" ? "lost" : null;
  const outcome = result ? await recordResultOnWeb(deps(), designer, String(formData.get("enquiry") ?? ""), result) : ({ ok: false, reason: "not-allowed" } as const);
  revalidatePath("/designer", "layout");
  if (outcome.ok) redirect(back(formData, result!));
  redirect(back(formData, outcome.reason));
}
