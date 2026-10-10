import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, rawSql } from "../../src/db/client";
import { createPipelineRepo } from "../../src/lib/pipeline/repo";
import { processVaaniEvent, vaaniEventSchema } from "../../src/lib/pipeline/vaani-events";
import { fromIst } from "../../src/lib/rules/time";
import { clearSettingsCache, loadSettings } from "../../src/lib/settings/store";
import { evaluateEnquiry } from "../../src/lib/tools/handlers";
import { createToolRepo } from "../../src/lib/tools/repo";
import { rebuildTestSchema, seedTestSchema, TEST_SCHEMA, testSql } from "./helpers";

const sql = testSql();
const t = (name: string) => sql(`${TEST_SCHEMA}.${name}`);
const ROOM = "room-integration-1";
const PHONE = "+918056203599";
const TRANSCRIPT = "[14:01:02] AGENT: Hello, thank you for calling Aangan Studio. I'm the studio's AI assistant, and this call is recorded.\n\n[14:01:09] USER: I want my 3BHK in Kothrud redone by March. I'm the owner.";

beforeAll(() => {
  rebuildTestSchema();
  seedTestSchema();
  clearSettingsCache();
}, 180_000);

afterAll(async () => {
  await sql.end();
  await rawSql().end();
});

describe("a full call through the pipeline", () => {
  it("links the call to the enquiry, records cost, queues one handoff and flags CRM sync", async () => {
    const now = new Date();
    const toolDeps = { repo: createToolRepo(db), now: () => now, settings: () => loadSettings() };
    const evaluation = await evaluateEnquiry(
      {
        phone: PHONE,
        facts: { project_type: "residential", execution: "yes", scope_text: "Redo the whole 3BHK", full_home: true, sqft: 1400, locality: "Kothrud", deadline_text: "done by March", decision_text: "I'm the owner" },
      },
      toolDeps,
    );
    expect(evaluation.body.outcome).toBe("QUALIFIED");

    let noteCalls = 0;
    const deps = {
      repo: createPipelineRepo(db),
      now: () => now,
      settings: () => loadSettings(),
      writeNote: async () => {
        noteCalls += 1;
        return { note: { one_line_summary: "3BHK in Kothrud", criteria: {} }, disagreements: [], inputTokens: 1000, outputTokens: 200 };
      },
    };
    const events = [
      { event: "call_started", room_name: ROOM, status: "dialing", phone_number: PHONE },
      { event: "call_ended", room_name: ROOM, call_duration: 245, end_reason: "AGENT_REQUESTED_DISCONNECT" },
      { event: "call_postprocessing", call_id: ROOM, data: { room_name: ROOM, call_duration: 245000, transcript: TRANSCRIPT, summary: "3BHK Kothrud" } },
    ];
    for (const event of events) await processVaaniEvent(vaaniEventSchema.parse(event), deps);
    // Re-processing changes nothing.
    for (const event of events) await processVaaniEvent(vaaniEventSchema.parse(event), deps);

    const [call] = await sql<{ enquiry_id: string; duration_s: number; transcript: string }[]>`select enquiry_id, duration_s, transcript from ${t("calls")} where vaani_call_id = ${ROOM}`;
    expect(call).toMatchObject({ enquiry_id: evaluation.body.enquiry_id, duration_s: 245, transcript: TRANSCRIPT });

    const costs = await sql<{ kind: string; qty: number; amount_inr: number }[]>`select kind, qty::float as qty, amount_inr::float as amount_inr from ${t("cost_lines")} order by kind`;
    expect(costs.map((cost) => cost.kind)).toEqual(["agent_min", "ai_in_tok", "ai_out_tok", "telephony_min"]);
    expect(costs.find((cost) => cost.kind === "agent_min")).toMatchObject({ qty: 5, amount_inr: 24.6 });

    const handoffs = await sql<{ note: { one_line_summary: string } }[]>`select note from ${t("handoffs")}`;
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0].note.one_line_summary).toBe("3BHK in Kothrud");

    const [enquiry] = await sql<{ flags: string[] }[]>`select flags from ${t("enquiries")} where id = ${String(evaluation.body.enquiry_id)}`;
    expect(enquiry.flags).toContain("sync_pending");
    expect(noteCalls).toBe(1); // re-processing does not call the model again
  });
});
