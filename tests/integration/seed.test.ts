import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SETTING_DEFINITIONS } from "../../src/lib/settings/definitions";
import { FESTIVAL_DATES, LOCALITIES, STAFF } from "../../src/lib/settings/seed-data";
import { rebuildTestSchema, seedTestSchema, TEST_SCHEMA, testSql } from "./helpers";

const sql = testSql();
const t = (name: string) => sql(`${TEST_SCHEMA}.${name}`);

async function counts() {
  const [row] = await sql<Record<string, number>[]>`
    select
      (select count(*)::int from ${t("settings")}) as settings,
      (select count(*)::int from ${t("settings_versions")}) as versions,
      (select count(*)::int from ${t("localities")}) as localities,
      (select count(*)::int from ${t("festival_dates")}) as festivals,
      (select count(*)::int from ${t("staff")}) as staff`;
  return row;
}

beforeAll(() => {
  rebuildTestSchema();
}, 120_000);

afterAll(async () => {
  await sql.end();
});

describe("seed", () => {
  it("creates every setting, locality, festival and placeholder person once", async () => {
    seedTestSchema();
    expect(await counts()).toEqual({
      settings: SETTING_DEFINITIONS.length,
      versions: 1,
      localities: LOCALITIES.length,
      festivals: FESTIVAL_DATES.length,
      staff: STAFF.length,
    });
  }, 60_000);

  it("is idempotent", async () => {
    const before = await counts();
    seedTestSchema();
    expect(await counts()).toEqual(before);
  }, 60_000);

  it("keeps a value an admin changed", async () => {
    await sql`update ${t("settings")} set value = '45'::jsonb where key = 'accept_escalate_min'`;
    seedTestSchema();
    const [row] = await sql<{ value: number; default_value: number }[]>`
      select value, default_value from ${t("settings")} where key = 'accept_escalate_min'`;
    expect(row).toEqual({ value: 45, default_value: 30 });
  }, 60_000);

  it("stores no price figure outside the budget floors setting", async () => {
    const rows = await sql<{ key: string }[]>`
      select key from ${t("settings")} where key ilike '%price%' or key ilike '%quote%' or key ilike '%pricing%'`;
    expect(rows.map((row) => row.key)).toEqual([]);
  });
});
