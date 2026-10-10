import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rebuildTestSchema, TEST_SCHEMA, testSql } from "./helpers";

const sql = testSql();
const t = (name: string) => sql(`${TEST_SCHEMA}.${name}`);

const EXPECTED_TABLES = [
  "bookings",
  "callers",
  "calls",
  "cost_lines",
  "crm_links",
  "enquiries",
  "eval_items",
  "eval_runs",
  "festival_dates",
  "fixed_costs",
  "handoffs",
  "inbox",
  "localities",
  "settings",
  "settings_audit",
  "settings_versions",
  "staff",
  "tasks",
];

beforeAll(() => {
  rebuildTestSchema();
}, 120_000);

afterAll(async () => {
  await sql.end();
});

describe("aangan_test schema", () => {
  it("has every table from the design", async () => {
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = ${TEST_SCHEMA} and table_name <> '__migrations' order by 1`;
    expect(rows.map((row) => row.table_name)).toEqual(EXPECTED_TABLES);
  });

  it("enables row-level security on every table", async () => {
    const rows = await sql<{ relname: string; rls: boolean }[]>`
      select c.relname, c.relrowsecurity as rls from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = ${TEST_SCHEMA} and c.relkind = 'r'`;
    expect(rows.length).toBe(EXPECTED_TABLES.length + 1);
    expect(rows.filter((row) => !row.rls).map((row) => row.relname)).toEqual([]);
  });

  it("rejects a second caller with the same phone number", async () => {
    await sql`insert into ${t("callers")} (phone_e164) values ('+919800000001')`;
    await expect(sql`insert into ${t("callers")} (phone_e164) values ('+919800000001')`).rejects.toMatchObject({
      code: "23505",
    });
  });

  it("rejects a duplicate Vaani call id", async () => {
    await sql`insert into ${t("calls")} (vaani_call_id) values ('room-dup-1')`;
    await expect(sql`insert into ${t("calls")} (vaani_call_id) values ('room-dup-1')`).rejects.toMatchObject({
      code: "23505",
    });
  });

  it("rejects the same inbox event twice but allows the same id from another source", async () => {
    await sql`insert into ${t("inbox")} (source, external_id, payload) values ('vaani', 'evt-1', '{}')`;
    await expect(
      sql`insert into ${t("inbox")} (source, external_id, payload) values ('vaani', 'evt-1', '{}')`,
    ).rejects.toMatchObject({ code: "23505" });
    await sql`insert into ${t("inbox")} (source, external_id, payload) values ('calcom', 'evt-1', '{}')`;
  });

  it("rejects an outcome outside the five plus PENDING", async () => {
    const [caller] = await sql<{ id: string }[]>`
      insert into ${t("callers")} (phone_e164) values ('+919800000002') returning id`;
    await expect(
      sql`insert into ${t("enquiries")} (caller_id, outcome) values (${caller.id}, 'MAYBE')`,
    ).rejects.toMatchObject({ code: "23514" });
  });
});
