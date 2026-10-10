import { after, NextResponse } from "next/server";
import { db } from "@/db/client";
import { secretMatches } from "@/lib/http/auth";
import { createInboxStore } from "@/lib/inbox/store";
import { createGeminiNoteWriter } from "@/lib/note";
import { createPipelineRepo } from "@/lib/pipeline/repo";
import { processVaaniEvent, vaaniEventSchema, vaaniExternalId } from "@/lib/pipeline/vaani-events";
import { loadSettings } from "@/lib/settings/store";

export const dynamic = "force-dynamic";

// Vaani does not sign webhooks, so the URL carries a long random token, compared in constant time.
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!secretMatches(token, process.env.VAANI_WEBHOOK_TOKEN)) {
    return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401 });
  }
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "body must be JSON" }, { status: 400 });
  }
  const parsed = vaaniEventSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ ok: true, ignored: "unrecognised payload" });

  const store = createInboxStore(db);
  const inboxId = await store.insert("vaani", vaaniExternalId(parsed.data), json);
  if (inboxId === null) return NextResponse.json({ ok: true, duplicate: true });

  after(async () => {
    try {
      await processVaaniEvent(parsed.data, {
        repo: createPipelineRepo(db),
        now: () => new Date(),
        settings: () => loadSettings(),
        writeNote: process.env.GEMINI_API_KEY
          ? createGeminiNoteWriter({ apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL ?? "gemini-3.8-flash" })
          : undefined,
      });
      await store.markProcessed(inboxId);
    } catch (error) {
      await store.markFailed(inboxId, error instanceof Error ? error.message : "unknown error");
    }
  });
  return NextResponse.json({ ok: true });
}
