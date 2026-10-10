import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, rawSql } from "../../src/db/client";
import { createFollowupRepo } from "../../src/lib/followups/repo";
import { runFollowups } from "../../src/lib/followups/run";
import { defaultRulesConfig } from "../../src/lib/rules/config";
import { describeCallback } from "../../src/lib/rules/office-time";
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

describe("overdue existing-client callbacks", () => {
  it("escalates a late existing-client callback to the founder once, with the number from the task", async () => {
    await sql`delete from ${t("tasks")}`;
    const now = fromIst(2026, 10, 13, 12, 0);
    await sql`insert into ${t("tasks")} (kind, reason, payload, due_at, chat_id, created_at) values
      ('urgent', 'Existing client needs a senior callback', ${sql.json({ phone: "+919800000077", summary: "Leak in the kitchen" })}, ${fromIst(2026, 10, 13, 11, 0)}, -1002, ${fromIst(2026, 10, 13, 10, 0)}),
      ('urgent', 'Not due yet', ${sql.json({ phone: "+919800000078" })}, ${fromIst(2026, 10, 13, 13, 0)}, -1002, ${fromIst(2026, 10, 13, 10, 0)})`;
    const sent: OutgoingMessage[] = [];
    const telegram: TelegramClient = { send: async (message) => (sent.push(message), { messageId: sent.length }), edit: async () => {}, answer: async () => {} };
    const deps = {
      repo: createFollowupRepo(db),
      telegram,
      chats: { designers: -1001, front_desk: -1002, founder: 55 },
      rules: defaultRulesConfig(),
      values: { accept_reminder_min: 15, accept_escalate_min: 30, outcome_nudge_max: 3, dropped_call_callback_min: 5 },
      now: () => now,
    };
    const first = await runFollowups(deps);
    expect(first.callback_escalations).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].chatId).toBe(55);
    expect(sent[0].html).toContain("Client callback overdue");
    expect(sent[0].html).toContain("+919800000077");
    expect((await runFollowups(deps)).callback_escalations).toBe(0);
    await sql`delete from ${t("tasks")}`;
  });
});

describe("dropped calls", () => {
  it("files the callback with the usual callback promise, not as already due", async () => {
    await sql`delete from ${t("tasks")}`;
    const now = new Date();
    const ended = new Date(now.getTime() - 10 * 60_000);
    const [caller] = await sql<{ id: string }[]>`insert into ${t("callers")} (phone_e164, name) values ('+919800000091', 'Dropped Dev') returning id`;
    await sql`insert into ${t("calls")} (vaani_call_id, caller_id, direction, started_at, ended_at, dropped, created_at)
              values ('dropped-1', ${caller.id}, 'in', ${new Date(ended.getTime() - 60_000)}, ${ended}, true, ${ended})`;
    const rules = defaultRulesConfig();
    const summary = await runFollowups({
      repo: createFollowupRepo(db),
      telegram: null,
      chats: { designers: null, front_desk: null, founder: null },
      rules,
      values: { accept_reminder_min: 15, accept_escalate_min: 30, outcome_nudge_max: 3, dropped_call_callback_min: 5 },
      now: () => now,
    });
    expect(summary.callback_tasks).toBe(1);
    const [task] = await sql<{ due_at: Date }[]>`select due_at from ${t("tasks")} where kind = 'callback'`;
    const expected = describeCallback(now, rules.office, rules.callbackWithinMin, rules.afterHoursCallbackTime).at;
    expect(task.due_at.getTime()).toBe(expected.getTime());
    expect(task.due_at.getTime()).toBeGreaterThan(now.getTime());
    await sql`delete from ${t("tasks")}`;
    await sql`delete from ${t("calls")} where vaani_call_id = 'dropped-1'`;
  });
});

describe("telegram dispatch selection", () => {
  it("never re-sends a task that is done or already posted, even when it is past due", async () => {
    const { createDispatchRepo } = await import("../../src/lib/telegram/repo");
    const sql = testSql();
    const t = (name: string) => sql(`${TEST_SCHEMA}.${name}`);
    await sql`delete from ${t("tasks")}`;
    await sql`insert into ${t("tasks")} (kind, reason, due_at, done_at, chat_id, created_at) values
      ('callback', 'done and posted', now() - interval '1 hour', now(), 1, now() - interval '2 hours'),
      ('callback', 'posted, not done', now() - interval '1 hour', null, 1, now() - interval '2 hours'),
      ('urgent', 'done, never posted', now() - interval '1 hour', now(), null, now() - interval '2 hours'),
      ('callback', 'waiting to post', now() - interval '1 hour', null, null, now() - interval '2 hours'),
      ('nurture', 'nurture not due', now() + interval '1 day', null, null, now())`;
    const pending = await createDispatchRepo(db, "https://example.test").pendingTasks(20);
    expect(pending.map((task) => task.reason)).toEqual(["waiting to post"]);
    await sql`delete from ${t("tasks")}`;
    await sql.end();
  });
});
