import "server-only";
import { log } from "../log";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { secretMatches } from "../http/auth";
import { loadSettings } from "../settings/store";
import { createToolRepo } from "./repo";
import type { ToolDeps, ToolResponse } from "./types";

type Handler = (input: unknown, deps: ToolDeps) => Promise<ToolResponse>;

const FAILURE_LINE = "Sorry, I'm having trouble checking that right now. Someone from our team will call you back shortly.";

// Wraps a tool handler with the shared-secret check, JSON parsing and a spoken fallback on errors.
export function toolRoute(handler: Handler) {
  return async function POST(request: Request) {
    if (!secretMatches(request.headers.get("x-tool-key"), process.env.TOOL_SECRET)) {
      return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401 });
    }
    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: "body must be JSON", say_line: "Sorry, I didn't catch that properly. Could you say that again?" },
        { status: 200 },
      );
    }
    try {
      const deps: ToolDeps = { repo: createToolRepo(db), now: () => new Date(), settings: () => loadSettings() };
      const response = await handler(input, deps);
      // Field names and expected types only, so a mismatch with Vaani's request shape shows in the logs.
      if (response.status === 400) log.warn("tool input rejected", { tool: new URL(request.url).pathname, error: (response.body as { error?: unknown }).error });
      // Vaani does not pass the body of a non-2xx reply to the model, which then makes up a line.
      // Every answer the agent should hear goes back as 200; auth failures stay 401.
      return NextResponse.json(response.body, { status: 200 });
    } catch (error) {
      log.error("tool failed", error);
      return NextResponse.json({ ok: false, error: "internal", say_line: FAILURE_LINE }, { status: 200 });
    }
  };
}
