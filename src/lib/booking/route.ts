import "server-only";
import { log } from "../log";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { createCalcomClient } from "../calendar";
import { requireEnv } from "../env";
import { secretMatches } from "../http/auth";
import { loadSettings } from "../settings/store";
import type { ToolResponse } from "../tools/types";
import { createBookingRepo } from "./repo";
import type { BookingDeps } from "./types";

type Handler = (input: unknown, deps: BookingDeps) => Promise<ToolResponse>;

const FAILURE_LINE = "Sorry, I'm having trouble with our calendar right now. Someone from our team will call you back to fix a time.";

export function bookingRoute(handler: Handler) {
  return async function POST(request: Request) {
    if (!secretMatches(request.headers.get("x-tool-key"), process.env.TOOL_SECRET)) {
      return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401 });
    }
    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: "body must be JSON", say_line: "Sorry, could you say that again?" }, { status: 400 });
    }
    try {
      const deps: BookingDeps = {
        repo: createBookingRepo(db),
        calendar: createCalcomClient(requireEnv("CALCOM_API_KEY")),
        now: () => new Date(),
        settings: () => loadSettings(),
      };
      const response = await handler(input, deps);
      // Field names and expected types only, so a mismatch with Vaani's request shape shows in the logs.
      if (response.status === 400) log.warn("tool input rejected", { tool: new URL(request.url).pathname, error: (response.body as { error?: unknown }).error });
      return NextResponse.json(response.body, { status: response.status });
    } catch (error) {
      log.error("booking tool failed", error);
      return NextResponse.json({ ok: false, error: "internal", say_line: FAILURE_LINE }, { status: 500 });
    }
  };
}
