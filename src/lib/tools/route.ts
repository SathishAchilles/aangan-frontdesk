import "server-only";
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
        { status: 400 },
      );
    }
    try {
      const deps: ToolDeps = { repo: createToolRepo(db), now: () => new Date(), settings: () => loadSettings() };
      const response = await handler(input, deps);
      return NextResponse.json(response.body, { status: response.status });
    } catch (error) {
      console.error("tool failed", error instanceof Error ? error.message : "unknown error");
      return NextResponse.json({ ok: false, error: "internal", say_line: FAILURE_LINE }, { status: 500 });
    }
  };
}
