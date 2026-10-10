// Eval replay-correctness: "Preview impact" is only trustworthy if replaying an enquiry under the
// settings version it was decided with reproduces its stored outcome. Enquiries are created through
// the real evaluate_enquiry handler in aangan_test, then replayed from their settings snapshot.
import postgres from "postgres";
import { rulesConfigFromSettings } from "../../lib/rules/config";
import { loadReference, loadReplayRows, replay } from "../../lib/settings/replay";
import { evaluateEnquiry as evaluateTool } from "../../lib/tools/handlers";
import type { CallerRecord, EnquiryRecord, ToolRepo } from "../../lib/tools/types";
import { loadJsonl } from "../datasets";
import type { EvalRunner } from "../registry";
import { buildReport } from "../report";
import { goldEnquirySchema, type ItemResult } from "../types";

const SCHEMA = "aangan_test";

function sqlToolRepo(sql: postgres.Sql): ToolRepo {
  const t = (name: string) => sql(`${SCHEMA}.${name}`);
  const toEnquiry = (row: Record<string, unknown>): EnquiryRecord => ({
    id: String(row.id),
    callerId: String(row.caller_id),
    intent: String(row.intent),
    outcome: row.outcome as EnquiryRecord["outcome"],
    facts: (row.facts ?? {}) as EnquiryRecord["facts"],
    asked: (row.asked ?? []) as EnquiryRecord["asked"],
    createdAt: new Date(String(row.created_at)),
  });
  return {
    findCallerByPhone: async (phone) => ((await sql<CallerRecord[]>`select id, phone_e164 as "phoneE164", name from ${t("callers")} where phone_e164 = ${phone}`)[0] ?? null),
    upsertCaller: async (phone) =>
      (await sql<CallerRecord[]>`insert into ${t("callers")} (phone_e164) values (${phone}) on conflict (phone_e164) do update set last_seen_at = now() returning id, phone_e164 as "phoneE164", name`)[0],
    latestEnquiry: async () => null,
    getEnquiry: async (id) => {
      const [row] = await sql`select * from ${t("enquiries")} where id = ${id}`;
      return row ? toEnquiry(row) : null;
    },
    createEnquiry: async (callerId, intent) => toEnquiry((await sql`insert into ${t("enquiries")} (caller_id, intent) values (${callerId}, ${intent}) returning *`)[0]),
    saveEvaluation: async (id, patch) => {
      await sql`update ${t("enquiries")} set intent = ${patch.intent}, outcome = ${patch.outcome}, facts = ${sql.json(patch.facts as never)}, asked = ${patch.asked},
                criteria = ${sql.json(patch.criteria as never)}, flags = ${patch.flags}, consult_type = ${patch.consultType}, settings_version = ${patch.settingsVersion} where id = ${id}`;
    },
    createTask: async () => ({ id: "unused" }),
  };
}

export const replayCorrectness: EvalRunner = async ({ budget }) => {
  const startedAt = new Date();
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) throw new Error("DATABASE_MIGRATION_URL is not set");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const items: ItemResult[] = [];
  try {
    await sql.unsafe(`delete from "${SCHEMA}".bookings; delete from "${SCHEMA}".handoffs; delete from "${SCHEMA}".tasks; delete from "${SCHEMA}".cost_lines; delete from "${SCHEMA}".calls; delete from "${SCHEMA}".crm_links; delete from "${SCHEMA}".enquiries; delete from "${SCHEMA}".callers;`);
    const reference = await loadReference(sql, SCHEMA);
    const [latest] = await sql<{ id: number; snapshot: Record<string, unknown> }[]>`select id, snapshot from ${sql(`${SCHEMA}.settings_versions`)} order by id desc limit 1`;
    const rules = rulesConfigFromSettings(latest.snapshot, reference.localities, reference.festivals);
    const repo = sqlToolRepo(sql);
    const gold = loadJsonl("enquiries-40.jsonl", goldEnquirySchema).filter((item) => item.gradable);
    for (const [index, item] of gold.entries()) {
      const { intent, ...facts } = item.facts;
      const now = new Date(item.received_at);
      await evaluateTool(
        { phone: `+9199995${String(index).padStart(5, "0")}`, intent, facts, asked: ["C1", "C2", "C3"] },
        { repo, now: () => now, settings: async () => ({ rules, version: latest.id }) },
      );
    }
    await sql`update ${sql(`${SCHEMA}.enquiries`)} e set created_at = c.first_seen_at from ${sql(`${SCHEMA}.callers`)} c where c.id = e.caller_id`;
    // Replay each stored enquiry against the snapshot of the settings version it recorded.
    const rows = await loadReplayRows(sql, SCHEMA, 500);
    const goldByPhoneIndex = new Map(gold.map((item, index) => [`+9199995${String(index).padStart(5, "0")}`, item]));
    const phones = new Map((await sql<{ id: string; phone: string }[]>`select e.id, c.phone_e164 as phone from ${sql(`${SCHEMA}.enquiries`)} e join ${sql(`${SCHEMA}.callers`)} c on c.id = e.caller_id`).map((row) => [row.id, row.phone]));
    const snapshots = new Map((await sql<{ id: number; snapshot: Record<string, unknown> }[]>`select id, snapshot from ${sql(`${SCHEMA}.settings_versions`)}`).map((row) => [row.id, row.snapshot]));
    for (const row of rows) {
      const goldItem = goldByPhoneIndex.get(phones.get(row.id) ?? "");
      const snapshot = snapshots.get(row.settings_version ?? -1);
      if (!goldItem || !snapshot) continue;
      const [replayed] = replay([{ ...row, created_at: new Date(goldItem.received_at) }], snapshot, reference);
      items.push({ item_id: goldItem.id, expected: row.outcome, actual: replayed.outcome, scores: { reproduced: replayed.outcome === row.outcome }, passed: replayed.outcome === row.outcome });
    }
  } finally {
    await sql.end();
  }
  const reproduced = items.filter((item) => item.passed).length;
  return buildReport({
    evalName: "replay-correctness",
    datasetVersion: "enquiries-40-through-tool",
    startedAt,
    metrics: { enquiries: items.length, reproduced, reproduce_rate: items.length ? reproduced / items.length : 0 },
    thresholds: [
      { metric: "reproduce_rate", op: "==", value: 1, hard: true },
      { metric: "enquiries", op: ">=", value: 39 },
    ],
    items,
    costInr: budget.spentInr,
  });
};
