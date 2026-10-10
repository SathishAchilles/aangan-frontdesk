import { and, isNull, lt, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { calls, inbox, tasks } from "@/db/schema";
import { createBookingEventRepo } from "@/lib/booking/calcom-event-repo";
import { calcomEventSchema, processCalcomEvent } from "@/lib/booking/calcom-webhook";
import { createHubspotClient, syncEnquiryToCrm } from "@/lib/crm";
import { createCrmLinkRepo, enquiriesToSync } from "@/lib/crm-repo";
import { createFollowupRepo } from "@/lib/followups/repo";
import { runFollowups } from "@/lib/followups/run";
import { secretMatches } from "@/lib/http/auth";
import { createInboxStore } from "@/lib/inbox/store";
import { createGeminiNoteWriter } from "@/lib/note";
import { createPipelineRepo } from "@/lib/pipeline/repo";
import { processVaaniEvent, vaaniEventSchema } from "@/lib/pipeline/vaani-events";
import { loadSettings } from "@/lib/settings/store";
import { handleCallbackQuery } from "@/lib/telegram/actions";
import { createTelegramClient } from "@/lib/telegram/client";
import { dispatchPending, type StaffChats } from "@/lib/telegram/dispatch";
import { createDispatchRepo, createTelegramActionRepo } from "@/lib/telegram/repo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ATTEMPTS = 5;

// Called every two minutes by pg_cron (pg_net) with the CRON_SECRET as a bearer token.
export async function POST(request: Request) {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secretMatches(bearer, process.env.CRON_SECRET)) return NextResponse.json({ ok: false }, { status: 401 });

  const now = new Date();
  const { rules, values } = await loadSettings();
  const chats = (values.telegram_chats ?? { designers: null, front_desk: null, founder: null }) as StaffChats;
  const telegram = process.env.TELEGRAM_BOT_TOKEN ? createTelegramClient(process.env.TELEGRAM_BOT_TOKEN) : null;
  const result: Record<string, unknown> = {};
  const errors: string[] = [];
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      result[name] = await fn();
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : "failed"}`);
    }
  };

  // 1. Retry inbox rows that failed or were never processed.
  await step("inbox_retry", async () => {
    const store = createInboxStore(db);
    const stuck = await db.select().from(inbox).where(and(isNull(inbox.processedAt), lt(inbox.receivedAt, sql`now() - interval '2 minutes'`))).limit(20);
    let retried = 0;
    let alerted = 0;
    for (const row of stuck) {
      if (row.attempts >= MAX_ATTEMPTS) {
        if (!row.lastError?.startsWith("[alerted]")) {
          await db.insert(tasks).values({ kind: "alert", reason: `Event from ${row.source} failed ${row.attempts} times`, payload: { inbox_id: row.id, error: row.lastError, notify: ["founder"] } });
          await db.update(inbox).set({ lastError: `[alerted] ${row.lastError ?? ""}` }).where(sql`${inbox.id} = ${row.id}`);
          alerted += 1;
        }
        continue;
      }
      try {
        if (row.source === "vaani") {
          await processVaaniEvent(vaaniEventSchema.parse(row.payload), {
            repo: createPipelineRepo(db),
            now: () => now,
            settings: () => loadSettings(),
            writeNote: process.env.GEMINI_API_KEY ? createGeminiNoteWriter({ apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL ?? "gemini-3.8-flash" }) : undefined,
          });
        } else if (row.source === "calcom") {
          await processCalcomEvent(calcomEventSchema.parse(row.payload), createBookingEventRepo(db), (values.calcom_event_types ?? {}) as Record<string, number | null>);
        } else if (row.source === "telegram" && telegram) {
          const query = (row.payload as { callback_query?: Parameters<typeof handleCallbackQuery>[0] }).callback_query;
          if (query) await handleCallbackQuery(query, { repo: createTelegramActionRepo(db), telegram, now: () => now });
        }
        await store.markProcessed(row.id);
        retried += 1;
      } catch (error) {
        await store.markFailed(row.id, error instanceof Error ? error.message : "unknown error");
      }
    }
    return { retried, alerted };
  });

  // 2. Reminders, escalations, nudges, nurture and dropped-call callbacks.
  await step("followups", () =>
    runFollowups({ repo: createFollowupRepo(db), telegram, chats, rules, values, now: () => now }),
  );

  // 3. Post queued handoffs and tasks to staff chats.
  if (telegram) await step("telegram", () => dispatchPending({ repo: createDispatchRepo(db, process.env.APP_URL ?? "https://aangan-frontdesk.vercel.app"), telegram, chats }));

  // 4. CRM sync.
  if (process.env.HUBSPOT_PRIVATE_APP_TOKEN) {
    await step("crm", async () => {
      const client = createHubspotClient(process.env.HUBSPOT_PRIVATE_APP_TOKEN!);
      const links = createCrmLinkRepo(db);
      const stageLabels = values.hubspot_stages as Record<"new" | "booked" | "won" | "lost", string>;
      let synced = 0;
      for (const enquiry of await enquiriesToSync(db, 20)) {
        await syncEnquiryToCrm(enquiry, { client, links, stageLabels });
        synced += 1;
      }
      return { synced };
    });
  }

  // 5. Retention: drop recording links and transcripts after the configured number of days.
  await step("retention", async () => {
    const recordingDays = Number(values.retention_recording_days ?? 90);
    const transcriptDays = Number(values.retention_transcript_days ?? 365);
    const recordings = await db
      .update(calls)
      .set({ recordingUrl: null })
      .where(and(sql`${calls.recordingUrl} is not null`, lt(calls.createdAt, sql`now() - make_interval(days => ${recordingDays})`)))
      .returning({ id: calls.id });
    const transcripts = await db
      .update(calls)
      .set({ transcript: null, summary: null })
      .where(and(sql`${calls.transcript} is not null`, lt(calls.createdAt, sql`now() - make_interval(days => ${transcriptDays})`)))
      .returning({ id: calls.id });
    return { recordings_cleared: recordings.length, transcripts_cleared: transcripts.length };
  });

  return NextResponse.json({ ok: errors.length === 0, at: now.toISOString(), ...result, errors }, { status: errors.length === 0 ? 200 : 500 });
}
