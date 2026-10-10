// The one way settings change: validate, update, audit, snapshot a new version. Used by the admin
// page and scripts/set-setting.ts.
import type postgres from "postgres";
import { crossFieldErrors, validateSetting } from "./validate";

export type SaveResult = { ok: true; version: number } | { ok: false; error: string };

export async function saveSetting(
  sql: postgres.Sql,
  schema: string,
  input: { key: string; raw: string; reason: string; actorId: string | null },
): Promise<SaveResult> {
  if (input.reason.trim().length < 5) return { ok: false, error: "Give a reason (at least a few words)." };
  const validated = validateSetting(input.key, input.raw);
  if (!validated.ok) return validated;
  const t = (name: string) => sql(`${schema}.${name}`);
  try {
    return await sql.begin(async (tx) => {
      const rows = await tx<{ key: string; value: unknown }[]>`select key, value from ${t("settings")} for update`;
      const current = rows.find((row) => row.key === input.key);
      if (!current) throw new Error(`Setting ${input.key} is not seeded`);
      const next = Object.fromEntries(rows.map((row) => [row.key, row.key === input.key ? validated.value : row.value]));
      const problems = crossFieldErrors(next);
      if (problems.length > 0) throw new Error(problems.join(" "));
      await tx`update ${t("settings")} set value = ${tx.json(validated.value as never)}, updated_at = now(), updated_by = ${input.actorId} where key = ${input.key}`;
      await tx`insert into ${t("settings_audit")} (key, old_value, new_value, reason, actor_id)
               values (${input.key}, ${tx.json(current.value as never)}, ${tx.json(validated.value as never)}, ${input.reason.trim()}, ${input.actorId})`;
      const [version] = await tx<{ id: number }[]>`insert into ${t("settings_versions")} (snapshot, created_by) values (${tx.json(next as never)}, ${input.actorId}) returning id`;
      return { ok: true as const, version: version.id };
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save" };
  }
}
