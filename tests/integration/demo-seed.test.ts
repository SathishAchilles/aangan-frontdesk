// The demo seed must give the follow-ups job nothing to do. Seeds aangan_test, then runs every step
// of the cron route the way the route does, with Telegram, HubSpot and the outbound dialler
// replaced by recording fakes, and expects no sends, no CRM calls, no new tasks and no changed rows.
import { and, isNull, lt, sql as dsql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demoCounts, removeDemo, seedDemo } from "../../scripts/demo/db";
import { DEMO_PHONE_BLOCK, NUDGE_CAP } from "../../scripts/demo/constants";
import { db, rawSql } from "../../src/db/client";
import { inbox } from "../../src/db/schema";
import { type HubspotClient, syncEnquiryToCrm } from "../../src/lib/crm";
import { createCrmLinkRepo, enquiriesToSync } from "../../src/lib/crm-repo";
import { createFollowupRepo } from "../../src/lib/followups/repo";
import { outcomeNudgeDue } from "../../src/lib/followups/rules";
import { runFollowups } from "../../src/lib/followups/run";
import { applyRetention } from "../../src/lib/retention";
import { loadSettings } from "../../src/lib/settings/store";
import type { OutgoingMessage, TelegramClient } from "../../src/lib/telegram/client";
import { dispatchPending } from "../../src/lib/telegram/dispatch";
import { createDispatchRepo } from "../../src/lib/telegram/repo";
import { rebuildTestSchema, seedTestSchema, TEST_SCHEMA, testSql } from "./helpers";

const sql = testSql();
const t = (name: string) => sql(`${TEST_SCHEMA}.${name}`);
const DAY = 86_400_000;
const chats = { designers: -1001, front_desk: -1002, founder: 55 };

// Every row in every table the job or the seed could write, as one comparable string.
const WATCHED = ["callers", "enquiries", "calls", "bookings", "handoffs", "tasks", "cost_lines", "fixed_costs", "eval_runs", "crm_links", "inbox", "settings", "settings_versions", "staff", "localities", "festival_dates"];
async function snapshot(where: "all" | "non-demo"): Promise<Record<string, string>> {
  const block = `${DEMO_PHONE_BLOCK}%`;
  const filters: Record<string, string> = {
    callers: `phone_e164 not like '${block}'`,
    enquiries: `caller_id not in (select id from ${TEST_SCHEMA}.callers where phone_e164 like '${block}')`,
    calls: "vaani_call_id not like 'demo-%'",
    bookings: "calcom_uid not like 'demo-%'",
    handoffs: `enquiry_id not in (select e.id from ${TEST_SCHEMA}.enquiries e join ${TEST_SCHEMA}.callers c on c.id = e.caller_id where c.phone_e164 like '${block}')`,
    tasks: `enquiry_id is null or enquiry_id not in (select e.id from ${TEST_SCHEMA}.enquiries e join ${TEST_SCHEMA}.callers c on c.id = e.caller_id where c.phone_e164 like '${block}')`,
    cost_lines: `call_id not in (select id from ${TEST_SCHEMA}.calls where vaani_call_id like 'demo-%')`,
    fixed_costs: "item not like 'Demo · %'",
    eval_runs: "commit_sha <> 'demo-seed'",
  };
  const out: Record<string, string> = {};
  for (const table of WATCHED) {
    const filter = where === "non-demo" && filters[table] ? `where ${filters[table]}` : "";
    const [row] = await sql.unsafe<{ rows: string }[]>(`select coalesce(json_agg(x order by x::text), '[]')::text as rows from (select * from ${TEST_SCHEMA}.${table} ${filter}) x`);
    out[table] = row.rows;
  }
  return out;
}

function recordingTelegram() {
  const sent: OutgoingMessage[] = [];
  const telegram: TelegramClient = {
    async send(message) {
      sent.push(message);
      return { messageId: sent.length };
    },
    edit: async () => {},
    answer: async () => {},
  };
  return { sent, telegram };
}

function recordingHubspot() {
  const calls: string[] = [];
  const record =
    (name: string) =>
    async (...args: unknown[]): Promise<never> => {
      calls.push(`${name} ${JSON.stringify(args)}`);
      throw new Error("HubSpot must not be called for demo data");
    };
  const client: HubspotClient = {
    findContactByPhone: record("findContactByPhone"),
    createContact: record("createContact"),
    createDeal: record("createDeal"),
    updateDeal: record("updateDeal"),
    dealStages: record("dealStages"),
  };
  return { calls, client };
}

let before: Record<string, string>;

beforeAll(async () => {
  rebuildTestSchema();
  seedTestSchema();
  // Real-looking, already-handled rows that must survive seeding and removal untouched.
  const [caller] = await sql<{ id: string }[]>`insert into ${t("callers")} (phone_e164, name) values ('+919811100001', 'Control caller') returning id`;
  const [enquiry] = await sql<{ id: string }[]>`
    insert into ${t("enquiries")} (caller_id, outcome, consult_result, consult_result_at, created_at) values (${caller.id}, 'QUALIFIED', 'won', now() - interval '3 days', now() - interval '6 days') returning id`;
  const [call] = await sql<{ id: string }[]>`
    insert into ${t("calls")} (vaani_call_id, enquiry_id, caller_id, started_at, ended_at, duration_s, transcript, summary, created_at)
    values ('control-1', ${enquiry.id}, ${caller.id}, now() - interval '6 days', now() - interval '6 days', 200, '[10:00:00] AGENT: Hello', 'Control', now() - interval '6 days') returning id`;
  await sql`insert into ${t("handoffs")} (enquiry_id, chat_id, message_id, posted_at, accepted_at) values (${enquiry.id}, -1001, 1, now() - interval '6 days', now() - interval '6 days')`;
  await sql`insert into ${t("bookings")} (enquiry_id, calcom_uid, consult_type, start_at, status) values (${enquiry.id}, 'control-booking', 'studio', now() - interval '4 days', 'booked')`;
  await sql`insert into ${t("cost_lines")} (call_id, enquiry_id, kind, qty, unit_price_inr, amount_inr) values (${call.id}, ${enquiry.id}, 'agent_min', 4, 4.92, 19.68)`;
  await sql`insert into ${t("tasks")} (kind, reason, chat_id, message_id, done_at) values ('message', 'Control message', -1002, 2, now())`;
  await sql`insert into ${t("fixed_costs")} (month, item, amount_inr) values (date_trunc('month', now())::date, 'Vaani plan', 1200)`;
  await sql`insert into ${t("eval_runs")} (eval_name, dataset_version, commit_sha, started_at, finished_at, metrics, thresholds, passed)
            values ('gate-accuracy', 'v3', 'abc1234', now() - interval '1 day', now() - interval '1 day', '{"agreement": 0.93}', '[]', true)`;
  before = await snapshot("all");
}, 180_000);

afterAll(async () => {
  await sql.end();
  await rawSql().end();
});

describe("demo seed", () => {
  it("seeds every scenario and leaves the follow-ups job nothing to do", async () => {
    const { inserted, plan, skippedEvals } = await seedDemo(sql, TEST_SCHEMA);
    expect(inserted.calls).toBeGreaterThan(100);
    expect(inserted.handoffs).toBeGreaterThan(30);
    expect(skippedEvals).toEqual(["gate-accuracy"]);
    const outcomes = new Set(plan.enquiries.map((e) => e.outcome));
    for (const outcome of ["PENDING", "QUALIFIED", "QUALIFIED_WITH_NOTES", "NOT_QUALIFIED", "NEEDS_HUMAN", "NOT_ENQUIRY"]) expect(outcomes).toContain(outcome);
    const failing = new Set(plan.enquiries.flatMap((e) => e.criteria.filter((c) => c.state === "fail").map((c) => c.id)));
    expect([...failing].sort()).toEqual(["C1", "C2", "C3", "C4"]);
    expect(plan.calls.filter((c) => c.grader_flags.price_figure.length + c.grader_flags.budget_question.length > 0)).toHaveLength(2);

    const seeded = await snapshot("all");
    const { rules, values } = await loadSettings();
    const repo = createFollowupRepo(db);

    // 1. Inbox retry: the route's own selection.
    const stuck = await db.select().from(inbox).where(and(isNull(inbox.processedAt), lt(inbox.receivedAt, dsql`now() - interval '2 minutes'`)));
    expect(stuck).toHaveLength(0);

    // 2. Follow-ups: nothing selected, and no action at now or after two months of ageing.
    expect(await repo.handoffsWaiting()).toHaveLength(0);
    expect(await repo.callbacksWaiting()).toHaveLength(0);
    expect(await repo.nurturesWaiting()).toHaveLength(0);
    expect(await repo.droppedCalls()).toHaveLength(0);
    const consults = await repo.consultsWaiting();
    for (const consult of consults) {
      expect(consult.nudges).toBe(NUDGE_CAP);
      for (const offset of [0, 1, 7, 60]) expect(outcomeNudgeDue(consult, new Date(Date.now() + offset * DAY), rules.office, NUDGE_CAP)).toBe(false);
    }
    const placed: string[] = [];
    for (const offset of [0, 1, 7, 60]) {
      const { sent, telegram } = recordingTelegram();
      const summary = await runFollowups({ repo, telegram, chats, rules, values, now: () => new Date(Date.now() + offset * DAY), placeCallback: async (call) => {
          placed.push(call.callId);
          return true;
        },
      });
      expect(Object.values(summary).every((n) => n === 0)).toBe(true);
      expect(sent).toHaveLength(0);
    }
    expect(placed).toHaveLength(0);

    // 3. Telegram dispatch with every staff chat configured.
    const dispatchRepo = createDispatchRepo(db, "https://example.test");
    expect(await dispatchRepo.pendingHandoffs(1000)).toHaveLength(0);
    expect(await dispatchRepo.pendingTasks(1000)).toHaveLength(0);
    const { sent, telegram } = recordingTelegram();
    expect(await dispatchPending({ repo: dispatchRepo, telegram, chats })).toEqual({ handoffs: 0, tasks: 0, skipped: [] });
    expect(sent).toHaveLength(0);

    // 4. CRM sync.
    const hubspot = recordingHubspot();
    const toSync = await enquiriesToSync(db, 1000);
    expect(toSync).toHaveLength(0);
    for (const enquiry of toSync) await syncEnquiryToCrm(enquiry, { client: hubspot.client, links: createCrmLinkRepo(db), stageLabels: values.hubspot_stages as Record<"new" | "booked" | "won" | "lost", string> });
    expect(hubspot.calls).toHaveLength(0);

    // 5. Retention with the configured periods.
    expect(await applyRetention(rawSql(), TEST_SCHEMA, { recordings: Number(values.retention_recording_days), transcripts: Number(values.retention_transcript_days) })).toEqual({ recordings_cleared: 0, transcripts_cleared: 0 });

    // Nothing the job did changed a single row, demo or not.
    expect(await snapshot("all")).toEqual(seeded);
    const nonDemo = await snapshot("non-demo");
    expect(nonDemo).toEqual(before);
  });

  it("gives the same counts when seeded again", async () => {
    const first = await demoCounts(sql, TEST_SCHEMA);
    const { removed, inserted } = await seedDemo(sql, TEST_SCHEMA);
    expect(removed).toEqual(first);
    expect(inserted).toEqual(first);
    expect(await snapshot("non-demo")).toEqual(before);
  });

  it("removes every demo row and nothing else", async () => {
    const counts = await demoCounts(sql, TEST_SCHEMA);
    expect(await removeDemo(sql, TEST_SCHEMA)).toEqual(counts);
    expect(Object.values(await demoCounts(sql, TEST_SCHEMA)).every((n) => n === 0)).toBe(true);
    expect(await snapshot("all")).toEqual(before);
  });
});
