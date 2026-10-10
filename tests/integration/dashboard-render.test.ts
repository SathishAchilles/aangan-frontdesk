import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FIXTURE_RANGE, seedDashboardMonth } from "../../src/evals/fixtures/dashboard-month";
import { rebuildTestSchema, seedTestSchema, TEST_SCHEMA, testSql } from "./helpers";

// Pages call requireStaff(); the role decision itself is covered by src/lib/authz.test.ts.
const auth = vi.hoisted(() => ({ role: "admin" as "admin" | "viewer" }));
vi.mock("@/lib/auth", async () => {
  const { authorize } = await import("../../src/lib/authz");
  return {
    currentStaff: async () => ({ id: "00000000-0000-0000-0000-000000000001", name: "Test", role: auth.role, email: null }),
    requireStaff: async (roles: ("admin" | "viewer")[] = ["admin", "viewer"]) => {
      if (authorize({ role: auth.role }, roles) === "forbidden") throw new Error("NEXT_HTTP_ERROR_FALLBACK;403");
      return { id: "00000000-0000-0000-0000-000000000001", name: "Test", role: auth.role, email: null };
    },
  };
});

const sql = testSql();
const range = Promise.resolve({ ...FIXTURE_RANGE });
const html = async (page: Promise<ReactElement> | ReactElement) => renderToStaticMarkup(await page);

beforeAll(async () => {
  rebuildTestSchema();
  seedTestSchema();
  await seedDashboardMonth(sql, TEST_SCHEMA);
}, 300_000);

afterAll(async () => {
  await sql.end();
});

describe("dashboard pages render on the fixture month", () => {
  it("overview", async () => {
    const { default: Page } = await import("../../src/app/dashboard/page");
    const out = await html(Page({ searchParams: range }));
    expect(out).toContain("100");
    expect(out).toMatch(/Rs|₹/);
  });

  it("calls list masks phone numbers", async () => {
    const { default: Page } = await import("../../src/app/dashboard/calls/page");
    const out = await html(Page({ searchParams: range }));
    expect(out).toContain("Fixture 0");
    expect(out).not.toMatch(/\+919800000000/);
  });

  it("call detail", async () => {
    const [call] = await sql<{ id: string }[]>`select id from ${sql(`${TEST_SCHEMA}.calls`)} where vaani_call_id = 'fixture-0'`;
    const { default: Page } = await import("../../src/app/dashboard/calls/[id]/page");
    const out = await html(Page({ params: Promise.resolve({ id: call.id }) }));
    expect(out).toContain("Service area");
    expect(out).toContain("agent_min");
  });

  it("designers, costs and quality", async () => {
    const designers = (await import("../../src/app/dashboard/designers/page")).default;
    const costs = (await import("../../src/app/dashboard/costs/page")).default;
    const quality = (await import("../../src/app/dashboard/quality/page")).default;
    expect(await html(designers({ searchParams: range }))).toContain("Median accept time");
    expect(await html(costs({ searchParams: range }))).toContain("Per qualified lead");
    expect(await html(quality())).toContain("Latest result per eval");
  });

  it("settings and a setting's history for an admin", async () => {
    const settings = (await import("../../src/app/dashboard/settings/page")).default;
    const history = (await import("../../src/app/dashboard/settings/[key]/page")).default;
    const out = await html(settings({ searchParams: Promise.resolve({}) }));
    expect(out).toContain("accept_escalate_min");
    expect(out).not.toMatch(/pricing_mode|quote_price/);
    expect(await html(history({ params: Promise.resolve({ key: "accept_escalate_min" }) }))).toContain("History");
  });

  it("settings answer 403 to a viewer", async () => {
    auth.role = "viewer";
    const settings = (await import("../../src/app/dashboard/settings/page")).default;
    await expect(settings({ searchParams: Promise.resolve({}) })).rejects.toThrow(/403/);
    auth.role = "admin";
  });
});
