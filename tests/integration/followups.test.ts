import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, rawSql } from "../../src/db/client";
import { createFollowupRepo } from "../../src/lib/followups/repo";
import { runFollowups } from "../../src/lib/followups/run";
import { defaultRulesConfig } from "../../src/lib/rules/config";
import { fromIst } from "../../src/lib/rules/time";
import type { OutgoingMessage, TelegramClient } from "../../src/lib/telegram/client";
import { rebuildTestSchema, seedTestSchema, TEST_SCHEMA, testSql } from "./helpers";

const sql = testSql();
const t = (name: string) => sql(`${TEST_SCHEMA}.${name}`);

beforeAll(() => {
  rebuildTestSchema();
  seedTestSchema();
}, 180_000);

afterAll(async () => {
  await sql.end();
  await rawSql().end();
});

describe("follow-ups against the database", () => {
  it("sends each escalation once when two runs overlap", async () => {
    const posted = fromIst(2026, 10, 13, 11, 0);
    const now = fromIst(2026, 10, 13, 11, 40);
    const [caller] = await sql<{ id: string }[]>`insert into ${t("callers")} (phone_e164, name) values ('+919800000011', 'Priya') returning id`;
    const [enquiry] = await sql<{ id: string }[]>`insert into ${t("enquiries")} (caller_id, outcome) values (${caller.id}, 'QUALIFIED') returning id`;
    await sql`insert into ${t("handoffs")} (enquiry_id, posted_at, chat_id, message_id) values (${enquiry.id}, ${posted}, -1001, 1)`;

    const sent: OutgoingMessage[] = [];
    const telegram: TelegramClient = {
      async send(message) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        sent.push(message);
        return { messageId: sent.length };
      },
      edit: async () => {},
      answer: async () => {},
    };
    const deps = {
      repo: createFollowupRepo(db),
      telegram,
      chats: { designers: -1001, front_desk: -1002, founder: 55 },
      rules: defaultRulesConfig(),
      values: { accept_reminder_min: 15, accept_escalate_min: 30, outcome_nudge_max: 3, dropped_call_callback_min: 5 },
      now: () => now,
    };
    const [a, b] = await Promise.all([runFollowups(deps), runFollowups(deps)]);
    expect(a.escalations + b.escalations).toBe(1);
    // An escalation goes to the front desk and the founder: two messages, one escalation.
    expect(sent.map((message) => message.chatId).sort()).toEqual([-1002, 55]);

    const [handoff] = await sql<{ escalated_at: Date | null }[]>`select escalated_at from ${t("handoffs")}`;
    expect(handoff.escalated_at).not.toBeNull();

    const again = await runFollowups(deps);
    expect(again.escalations).toBe(0);
  });
});
