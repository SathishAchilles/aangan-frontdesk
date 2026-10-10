// "Preview impact": re-run recent enquiries' stored facts through the gate under proposed settings,
// so an admin sees which outcomes would change before saving.
import type postgres from "postgres";
import { rulesConfigFromSettings, type SettingValues } from "../rules/config";
import type { AskableCriterion, Facts } from "../rules/facts";
import { evaluateEnquiry, type Outcome } from "../rules/gate";

export type ReplayRow = { id: string; created_at: Date; facts: Facts; asked: AskableCriterion[]; outcome: Outcome; settings_version: number | null };
export type ReplayChange = { id: string; created_at: Date; from: Outcome; to: Outcome };

export async function loadReplayRows(sql: postgres.Sql, schema: string, limit = 200): Promise<ReplayRow[]> {
  return sql<ReplayRow[]>`
    select id, created_at, facts, asked, outcome, settings_version from ${sql(`${schema}.enquiries`)}
    where outcome <> 'PENDING' and facts <> '{}'::jsonb order by created_at desc limit ${limit}`;
}

export async function loadReference(sql: postgres.Sql, schema: string) {
  const localities = await sql<{ name: string; aliases: string[]; status: "in" | "out" }[]>`select name, aliases, status from ${sql(`${schema}.localities`)}`;
  const festivals = await sql<{ name: string; date: string }[]>`select name, to_char(date, 'YYYY-MM-DD') as date from ${sql(`${schema}.festival_dates`)}`;
  return { localities, festivals };
}

// Outcomes are compared after the call: every askable question counts as asked once.
export function replay(rows: ReplayRow[], values: SettingValues, reference: Awaited<ReturnType<typeof loadReference>>): { outcome: Outcome; row: ReplayRow }[] {
  const config = rulesConfigFromSettings(values, reference.localities, reference.festivals);
  return rows.map((row) => ({
    row,
    outcome: evaluateEnquiry({ facts: { ...row.facts, intent: row.facts.intent ?? "new" }, asked: ["C1", "C2", "C3"], now: new Date(row.created_at), config }).outcome,
  }));
}

export function previewImpact(rows: ReplayRow[], current: SettingValues, proposed: SettingValues, reference: Awaited<ReturnType<typeof loadReference>>): ReplayChange[] {
  const before = replay(rows, current, reference);
  const after = replay(rows, proposed, reference);
  return before
    .map((entry, index) => ({ id: entry.row.id, created_at: entry.row.created_at, from: entry.outcome, to: after[index].outcome }))
    .filter((change) => change.from !== change.to);
}
