import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, rawSql } from "../../src/db/client";
import { fromIst } from "../../src/lib/rules/time";
import { clearSettingsCache, loadSettings } from "../../src/lib/settings/store";
import { evaluateEnquiry, logIntent, lookupCaller } from "../../src/lib/tools/handlers";
import { createToolRepo } from "../../src/lib/tools/repo";
import type { ToolDeps } from "../../src/lib/tools/types";
import { rebuildTestSchema, seedTestSchema, TEST_SCHEMA, testSql } from "./helpers";

const sql = testSql();
const t = (name: string) => sql(`${TEST_SCHEMA}.${name}`);
const NOW = fromIst(2026, 10, 13, 14, 0);
const PHONE = "+918056203528";

let deps: ToolDeps;

beforeAll(() => {
  rebuildTestSchema();
  seedTestSchema();
  clearSettingsCache();
  deps = { repo: createToolRepo(db), now: () => NOW, settings: () => loadSettings() };
}, 180_000);

afterAll(async () => {
  await sql.end();
  await rawSql().end();
});

describe("tools against the database", () => {
  it("loads settings, localities and festivals from aangan_test", async () => {
    const loaded = await loadSettings();
    expect(loaded.version).toBe(1);
    expect(loaded.rules.localities.length).toBeGreaterThan(20);
    expect(loaded.rules.timelineHardFailWeeks).toBe(6);
  });

  it("creates the caller and enquiry and stores criteria with the settings version", async () => {
    const response = await evaluateEnquiry(
      {
        phone: PHONE,
        facts: {
          project_type: "residential",
          execution: "yes",
          scope_text: "Redo the whole 3BHK",
          full_home: true,
          sqft: 1400,
          locality: "Kothrud",
          deadline_text: "done by March",
          decision_text: "I'm the owner",
        },
      },
      deps,
    );
    expect(response.body.outcome).toBe("QUALIFIED");
    const [row] = await sql<{ outcome: string; settings_version: number; criteria: { id: string; state: string }[] }[]>`
      select outcome, settings_version, criteria from ${t("enquiries")} where id = ${String(response.body.enquiry_id)}`;
    expect(row.outcome).toBe("QUALIFIED");
    expect(row.settings_version).toBe(1);
    expect(row.criteria.map((criterion) => criterion.state)).toEqual(["pass", "pass", "pass", "not_mentioned", "pass"]);
  });

  it("finds the caller and enquiry on a repeat call", async () => {
    const response = await lookupCaller({ phone: "08056203528" }, deps);
    expect(response.body.open_enquiry).toMatchObject({ last_outcome: "QUALIFIED" });
  });

  it("stores the asked question so a later turn moves on", async () => {
    const first = await evaluateEnquiry({ phone: "+919800000009", facts: {} }, deps);
    const second = await evaluateEnquiry({ phone: "+919800000009", enquiry_id: first.body.enquiry_id, facts: {} }, deps);
    expect(second.body.asking).toBe("C2");
    const [row] = await sql<{ asked: string[] }[]>`select asked from ${t("enquiries")} where id = ${String(first.body.enquiry_id)}`;
    expect(row.asked).toEqual(["C1", "C2"]);
  });

  it("creates an urgent task for an existing client", async () => {
    await logIntent({ phone: PHONE, intent: "existing_client", summary: "Designer not replying" }, deps);
    const rows = await sql<{ kind: string }[]>`select kind from ${t("tasks")} where kind = 'urgent'`;
    expect(rows).toHaveLength(1);
  });
});
