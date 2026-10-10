import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveSetting } from "../../src/lib/settings/write";
import { rebuildTestSchema, seedTestSchema, TEST_SCHEMA, testSql } from "./helpers";

const sql = testSql();
const t = (name: string) => sql(`${TEST_SCHEMA}.${name}`);

beforeAll(() => {
  rebuildTestSchema();
  seedTestSchema();
}, 180_000);

afterAll(async () => {
  await sql.end();
});

describe("saving settings", () => {
  it("updates the value, writes an audit entry and a new version", async () => {
    const result = await saveSetting(sql, TEST_SCHEMA, { key: "accept_escalate_min", raw: "45", reason: "Designers are on site most mornings", actorId: null });
    expect(result).toEqual({ ok: true, version: 2 });
    const [setting] = await sql<{ value: number }[]>`select value from ${t("settings")} where key = 'accept_escalate_min'`;
    expect(setting.value).toBe(45);
    const [audit] = await sql<{ old_value: number; new_value: number; reason: string }[]>`select old_value, new_value, reason from ${t("settings_audit")} where key = 'accept_escalate_min'`;
    expect(audit).toEqual({ old_value: 30, new_value: 45, reason: "Designers are on site most mornings" });
    const [version] = await sql<{ snapshot: Record<string, unknown> }[]>`select snapshot from ${t("settings_versions")} where id = 2`;
    expect(version.snapshot.accept_escalate_min).toBe(45);
  });

  it("rejects an out-of-range value without writing anything", async () => {
    const result = await saveSetting(sql, TEST_SCHEMA, { key: "budget_clearly_below_pct", raw: "5", reason: "testing the range check", actorId: null });
    expect(result).toEqual({ ok: false, error: "Allowed range is 20 to 90" });
    const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from ${t("settings_audit")} where key = 'budget_clearly_below_pct'`;
    expect(count).toBe(0);
  });

  it("rejects a change that breaks a rule across settings", async () => {
    const result = await saveSetting(sql, TEST_SCHEMA, { key: "accept_reminder_min", raw: "50", reason: "testing the cross-field rule", actorId: null });
    expect(result.ok).toBe(false);
  });

  it("requires a reason", async () => {
    expect(await saveSetting(sql, TEST_SCHEMA, { key: "accept_reminder_min", raw: "10", reason: "", actorId: null })).toMatchObject({ ok: false });
  });
});
