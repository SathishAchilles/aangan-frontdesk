import { after, NextResponse } from "next/server";
import { db } from "@/db/client";
import { createBookingEventRepo } from "@/lib/booking/calcom-event-repo";
import { calcomEventSchema, calcomExternalId, processCalcomEvent, verifyCalcomSignature } from "@/lib/booking/calcom-webhook";
import { createInboxStore } from "@/lib/inbox/store";
import { loadSettings } from "@/lib/settings/store";

export const dynamic = "force-dynamic";

// Verify, store once, answer immediately; process after the response so Cal.com never times out.
export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyCalcomSignature(raw, request.headers.get("x-cal-signature-256"), process.env.CALCOM_WEBHOOK_SECRET)) {
    return NextResponse.json({ ok: false, error: "bad signature" }, { status: 401 });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "body must be JSON" }, { status: 400 });
  }
  const parsed = calcomEventSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ ok: true, ignored: "unrecognised payload" });
  // Cal.com sends a PING when the webhook is saved.
  if (parsed.data.triggerEvent === "PING") return NextResponse.json({ ok: true });

  const store = createInboxStore(db);
  const inboxId = await store.insert("calcom", calcomExternalId(parsed.data), json);
  if (inboxId === null) return NextResponse.json({ ok: true, duplicate: true });

  after(async () => {
    try {
      const { values } = await loadSettings();
      const eventTypeIds = (values.calcom_event_types ?? {}) as Record<string, number | null>;
      await processCalcomEvent(parsed.data, createBookingEventRepo(db), eventTypeIds);
      await store.markProcessed(inboxId);
    } catch (error) {
      // The follow-ups sweep retries unprocessed inbox rows.
      await store.markFailed(inboxId, error instanceof Error ? error.message : "unknown error");
    }
  });
  return NextResponse.json({ ok: true });
}
