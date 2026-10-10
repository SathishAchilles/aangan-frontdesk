import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db, rawSql } from "../../src/db/client";
import { requireActingDesigner, requireDesignerView } from "../../src/lib/designer/access";
import { leadDetail, myLeads, waitingHandoffs } from "../../src/lib/designer/queries";
import { acceptOnWeb, recordResultOnWeb, type WebActionDeps } from "../../src/lib/designer/web-actions";
import { handleCallbackQuery } from "../../src/lib/telegram/actions";
import type { InlineButton, TelegramClient } from "../../src/lib/telegram/client";
import { createTelegramActionRepo } from "../../src/lib/telegram/repo";
import { rebuildTestSchema, seedTestSchema, TEST_SCHEMA, testSql } from "./helpers";

type Role = "admin" | "viewer" | "designer" | "front_desk";
// The signed-in staff member. requireStaff mirrors the real one: wrong role -> 403, except a designer
// on an admin page, who is sent to /designer.
const auth = vi.hoisted(() => ({ me: null as null | { id: string; name: string; role: Role; email: null } }));
vi.mock("@/lib/auth", async () => {
  const { authorize, redirectInsteadOfForbidden } = await import("../../src/lib/authz");
  return {
    currentStaff: async () => auth.me,
    requireStaff: async (roles: Role[] = ["admin", "viewer"]) => {
      const access = authorize(auth.me, roles);
      if (access === "login" || !auth.me) throw new Error("NEXT_REDIRECT;/login");
      if (access === "forbidden") {
        const elsewhere = redirectInsteadOfForbidden(auth.me, roles);
        throw new Error(elsewhere ? `NEXT_REDIRECT;${elsewhere}` : "NEXT_HTTP_ERROR_FALLBACK;403");
      }
      return auth.me;
    },
  };
});

const sql = testSql();
const t = (name: string) => sql(`${TEST_SCHEMA}.${name}`);
const html = async (page: Promise<ReactElement> | ReactElement) => renderToStaticMarkup(await page);
const MIN = 60_000;
const DAY = 86_400_000;

type Staff = { id: string; name: string };
const people: Record<"d1" | "d2" | "d3" | "admin" | "viewer", Staff> = {} as never;
type Lead = { enquiry: string; handoff: string; phone: string };
const leads: Record<"a" | "b" | "c" | "d" | "e" | "f", Lead> = {} as never;

const edits: { chatId: number; messageId: number; html: string; buttons?: InlineButton[][] }[] = [];
const telegram: TelegramClient = {
  send: async () => ({ messageId: 1 }),
  edit: async (chatId, messageId, text, buttons) => {
    edits.push({ chatId, messageId, html: text, buttons });
  },
  answer: async () => {},
};
const deps = (): WebActionDeps => ({ db, sql: rawSql(), schema: TEST_SCHEMA, telegram, appUrl: "https://aangan.test", now: () => new Date() });

async function lead(input: {
  key: keyof typeof leads;
  phone: string;
  name: string;
  assigned: Staff | null;
  consultType: "studio" | "site" | "principal" | null;
  postedMinAgo: number;
  acceptedBy?: Staff;
  bookingInDays?: number;
  chat?: [number, number];
  note?: Record<string, unknown>;
  transcript?: string;
  summary?: string;
}) {
  const now = Date.now();
  const [caller] = await sql<{ id: string }[]>`insert into ${t("callers")} (phone_e164, name) values (${input.phone}, ${input.name}) returning id`;
  const facts = { locality: "Baner", property_kind: "apartment", rooms: ["kitchen", "living room"], scope_text: "Wants a warm, minimal look" };
  const [enquiry] = await sql<{ id: string }[]>`
    insert into ${t("enquiries")} (caller_id, outcome, consult_type, assigned_designer_id, facts, flags, created_at)
    values (${caller.id}, 'QUALIFIED', ${input.consultType}, ${input.assigned?.id ?? null}, ${sql.json(facts)}, '{}', ${new Date(now - 2 * DAY)}) returning id`;
  const posted = new Date(now - input.postedMinAgo * MIN);
  const accepted = input.acceptedBy ? new Date(posted.getTime() + 5 * MIN) : null;
  const [handoff] = await sql<{ id: string }[]>`
    insert into ${t("handoffs")} (enquiry_id, posted_at, accepted_at, accepted_by, chat_id, message_id, note)
    values (${enquiry.id}, ${posted}, ${accepted}, ${input.acceptedBy?.id ?? null}, ${input.chat?.[0] ?? null}, ${input.chat?.[1] ?? null}, ${input.note ? sql.json(input.note as never) : null}) returning id`;
  if (input.bookingInDays !== undefined) {
    await sql`insert into ${t("bookings")} (enquiry_id, calcom_uid, consult_type, start_at, designer_id, status)
              values (${enquiry.id}, ${`designer-test-${input.key}`}, ${input.consultType ?? "studio"}, ${new Date(now + input.bookingInDays * DAY)}, ${input.acceptedBy?.id ?? input.assigned?.id ?? null}, 'booked')`;
  }
  await sql`insert into ${t("calls")} (vaani_call_id, enquiry_id, caller_id, started_at, duration_s, transcript, summary)
            values (${`designer-test-${input.key}`}, ${enquiry.id}, ${caller.id}, ${new Date(now - 2 * DAY)}, 312, ${input.transcript ?? "Agent: Namaste, Aangan Studio.\nCaller: Hi."}, ${input.summary ?? null})`;
  leads[input.key] = { enquiry: enquiry.id, handoff: handoff.id, phone: input.phone };
}

const handoffRow = async (id: string) => (await sql<Record<string, unknown>[]>`select * from ${t("handoffs")} where id = ${id}`)[0];
const changedKeys = (before: Record<string, unknown>, after: Record<string, unknown>) =>
  Object.keys(after)
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .sort();
const as = (who: Staff, role: Role) => {
  auth.me = { id: who.id, name: who.name, role, email: null };
};

beforeAll(async () => {
  rebuildTestSchema();
  seedTestSchema();
  const staff = await sql<{ id: string; name: string; role: string }[]>`select id, name, role from ${t("staff")}`;
  const byName = (name: string) => staff.find((row) => row.name === name)!;
  people.d1 = byName("Designer 1 (principal)");
  people.d2 = byName("Designer 2");
  people.d3 = byName("Designer 3");
  people.admin = staff.find((row) => row.role === "admin")!;
  const [viewer] = await sql<Staff[]>`insert into ${t("staff")} (name, role) values ('Viewer', 'viewer') returning id, name`;
  people.viewer = viewer;
  await sql`update ${t("staff")} set telegram_user_id = 5551 where id = ${people.d1.id}`;

  const note = {
    client_name: "Asha",
    area: "Baner",
    property: "3BHK apartment",
    size_sqft: 1350,
    scope: "Kitchen and living room",
    timeline: "Move in by March",
    decision_maker: "Asha and her husband",
    budget_mentioned: "18 lakh",
    watch_outs: ["Tight timeline"],
    one_line_summary: "Couple redoing kitchen and living room in Baner",
    criteria: { C1: "pass", C2: "pass", C3: "pass", C4: "pass", C5: "unclear" },
  };
  await lead({
    key: "a",
    phone: "+919800000101",
    name: "Asha Kulkarni",
    assigned: people.d2,
    consultType: "studio",
    postedMinAgo: 30,
    bookingInDays: 1,
    chat: [-100, 7],
    note,
    transcript: "Agent: Which area is the flat in?\nCaller: Baner. My budget is around 18 lakhs. We move in March.",
    summary: "Caller wants a full kitchen redo.",
  });
  await lead({ key: "b", phone: "+919800000102", name: "Bhavna Joshi", assigned: null, consultType: "principal", postedMinAgo: 20 });
  await lead({ key: "c", phone: "+919800000103", name: "Chetan Rao", assigned: null, consultType: "studio", postedMinAgo: 10, chat: [-100, 8] });
  await lead({ key: "d", phone: "+919800000104", name: "Deepa Nair", assigned: people.d3, consultType: "site", postedMinAgo: 3000, acceptedBy: people.d3, bookingInDays: -1, chat: [-100, 9] });
  await lead({ key: "e", phone: "+919800000105", name: "Eshan Patil", assigned: people.d2, consultType: "studio", postedMinAgo: 2000, acceptedBy: people.d2, bookingInDays: 3 });
  await lead({ key: "f", phone: "+919800000106", name: "Farah Shaikh", assigned: null, consultType: null, postedMinAgo: 5 });
}, 300_000);

afterAll(async () => {
  await sql.end();
  await rawSql().end();
});

const waitingFor = async (who: Staff) => (await waitingHandoffs(rawSql(), TEST_SCHEMA, who.id, new Date())).map((row) => row.enquiryId).sort();
const sorted = (...keys: (keyof typeof leads)[]) => keys.map((key) => leads[key].enquiry).sort();

describe("what a designer sees", () => {
  it("only their own leads, and only handoffs they may accept", async () => {
    expect(await waitingFor(people.d2)).toEqual(sorted("a", "c", "f"));
    expect(await waitingFor(people.d3)).toEqual(sorted("c", "f"));
    const d2 = await myLeads(rawSql(), TEST_SCHEMA, people.d2.id, new Date());
    expect(d2.map((row) => row.enquiryId).sort()).toEqual(sorted("a", "e"));
    expect(d2.every((row) => row.phoneMasked?.includes("•"))).toBe(true);
    const d3 = await myLeads(rawSql(), TEST_SCHEMA, people.d3.id, new Date());
    expect(d3.map((row) => row.enquiryId)).toEqual([leads.d.enquiry]);
    expect(d3[0].needsResult).toBe(true);
  });

  it("unassigned handoffs go to designers whose consultation types match", async () => {
    expect(await waitingFor(people.d1)).toEqual(sorted("b", "c", "f"));
    expect(await waitingFor(people.d2)).not.toContain(leads.b.enquiry);
    await sql`update ${t("staff")} set consult_types = '{studio,site,principal}' where id = ${people.d2.id}`;
    expect(await waitingFor(people.d2)).toContain(leads.b.enquiry);
    await sql`update ${t("staff")} set consult_types = '{studio,site}' where id = ${people.d2.id}`;
  });

  it("a lead page is open to its owner (full number) and to designers who may accept it (masked)", async () => {
    const now = new Date();
    expect(await leadDetail(rawSql(), TEST_SCHEMA, people.d3.id, leads.a.enquiry, now)).toBeNull();
    const own = await leadDetail(rawSql(), TEST_SCHEMA, people.d2.id, leads.a.enquiry, now);
    expect(own?.owned).toBe(true);
    expect(own?.phone).toBe(leads.a.phone);
    const open = await leadDetail(rawSql(), TEST_SCHEMA, people.d3.id, leads.c.enquiry, now);
    expect(open?.owned).toBe(false);
    expect(open?.phone).toBeNull();
    expect(open?.handoff?.acceptable).toBe(true);
  });
});

describe("accepting on the web", () => {
  it("sets accepted_at and accepted_by exactly like the Telegram button", async () => {
    const webBefore = await handoffRow(leads.c.handoff);
    const outcome = await acceptOnWeb(deps(), people.d2, leads.c.handoff);
    expect(outcome).toEqual({ ok: true, enquiryId: leads.c.enquiry, telegramUpdated: true });
    const webAfter = await handoffRow(leads.c.handoff);

    const tgBefore = await handoffRow(leads.f.handoff);
    const pressed = await handleCallbackQuery(
      { id: "q1", from: { id: 5551 }, data: `acc:${leads.f.handoff}`, message: { message_id: 10, chat: { id: -100 }, text: "New enquiry" } },
      { repo: createTelegramActionRepo(db), telegram, now: () => new Date() },
    );
    expect(pressed.ok).toBe(true);
    const tgAfter = await handoffRow(leads.f.handoff);

    expect(changedKeys(webBefore, webAfter)).toEqual(["accepted_at", "accepted_by"]);
    expect(changedKeys(tgBefore, tgAfter)).toEqual(["accepted_at", "accepted_by"]);
    expect(webAfter.accepted_by).toBe(people.d2.id);
    expect(tgAfter.accepted_by).toBe(people.d1.id);
  });

  it("edits the posted Telegram message the way a button press does", () => {
    const edit = edits.find((entry) => entry.messageId === 8);
    expect(edit?.chatId).toBe(-100);
    expect(edit?.html).toContain("Chetan Rao");
    expect(edit?.html).toMatch(/✅ <b>Accepted by Designer 2<\/b> at \d\d:\d\d/);
    expect(edit?.buttons).toEqual([[{ text: "Won", callback_data: `won:${leads.c.enquiry}` }, { text: "Lost", callback_data: `lost:${leads.c.enquiry}` }]]);
  });

  it("first press wins, and nobody accepts another designer's lead", async () => {
    expect(await acceptOnWeb(deps(), people.d3, leads.c.handoff)).toEqual({ ok: false, reason: "taken", acceptedBy: "Designer 2" });
    const before = await handoffRow(leads.a.handoff);
    expect(await acceptOnWeb(deps(), people.d3, leads.a.handoff)).toEqual({ ok: false, reason: "not-allowed" });
    expect(await acceptOnWeb(deps(), people.d3, "not-a-uuid")).toEqual({ ok: false, reason: "not-allowed" });
    expect(await handoffRow(leads.a.handoff)).toEqual(before);
    // The accepted lead is now Designer 2's, and no longer open to Designer 3.
    expect((await myLeads(rawSql(), TEST_SCHEMA, people.d2.id, new Date())).map((row) => row.enquiryId)).toContain(leads.c.enquiry);
    expect(await leadDetail(rawSql(), TEST_SCHEMA, people.d3.id, leads.c.enquiry, new Date())).toBeNull();
  });
});

describe("won and lost on the web", () => {
  it("records the result once, for the owner, after the consultation", async () => {
    expect(await recordResultOnWeb(deps(), people.d2, leads.d.enquiry, "won")).toEqual({ ok: false, reason: "not-allowed" });
    expect(await recordResultOnWeb(deps(), people.d2, leads.e.enquiry, "won")).toEqual({ ok: false, reason: "not-allowed" });
    expect(await recordResultOnWeb(deps(), people.d3, leads.d.enquiry, "won")).toEqual({ ok: true });
    const [row] = await sql<{ consult_result: string; consult_result_at: Date | null; flags: string[] }[]>`
      select consult_result, consult_result_at, flags from ${t("enquiries")} where id = ${leads.d.enquiry}`;
    expect(row.consult_result).toBe("won");
    expect(row.consult_result_at).not.toBeNull();
    expect(row.flags).toContain("sync_pending");
    expect(await recordResultOnWeb(deps(), people.d3, leads.d.enquiry, "lost")).toEqual({ ok: false, reason: "already-recorded" });
    const edit = edits.find((entry) => entry.messageId === 9);
    expect(edit?.html).toContain("Accepted by Designer 3");
    expect(edit?.html).toContain("🏆 <b>Won</b> · recorded by Designer 3");
    expect(edit?.buttons).toBeUndefined();
  });
});

describe("access", () => {
  it("a designer always sees themselves, whatever ?as= says", async () => {
    as(people.d2, "designer");
    const view = await requireDesignerView(people.d3.id);
    expect(view).toMatchObject({ readOnly: false, as: null, designer: { id: people.d2.id } });
  });

  it("an admin views as a designer read-only and cannot act", async () => {
    as(people.admin, "admin");
    const view = await requireDesignerView(people.d2.id);
    expect(view).toMatchObject({ readOnly: true, as: people.d2.id, designer: { id: people.d2.id } });
    await expect(requireDesignerView(undefined)).rejects.toThrow(/NEXT_REDIRECT/);
    await expect(requireActingDesigner()).rejects.toThrow(/403/);
    const { acceptHandoffAction } = await import("../../src/app/designer/actions");
    const form = new FormData();
    form.set("handoff", leads.a.handoff);
    const before = await handoffRow(leads.a.handoff);
    await expect(acceptHandoffAction(form)).rejects.toThrow(/403/);
    expect(await handoffRow(leads.a.handoff)).toEqual(before);

    const { default: Day } = await import("../../src/app/designer/page");
    const out = await html(Day({ searchParams: Promise.resolve({ as: people.d2.id }) }));
    expect(out).toContain("read-only");
    expect(out).toContain("Asha Kulkarni");
    expect(out).not.toContain("<form");
    const { default: Lead } = await import("../../src/app/designer/leads/[id]/page");
    const detail = await html(Lead({ params: Promise.resolve({ id: leads.a.enquiry }), searchParams: Promise.resolve({ as: people.d2.id }) }));
    expect(detail).not.toContain(leads.a.phone);
    expect(detail).not.toContain("<form");
  });

  it("viewers and front desk are kept out", async () => {
    as(people.viewer, "viewer");
    await expect(requireDesignerView(people.d2.id)).rejects.toThrow(/403/);
    auth.me = { id: people.viewer.id, name: "Front", role: "front_desk", email: null };
    await expect(requireDesignerView(people.d2.id)).rejects.toThrow(/403/);
  });
});

describe("designer pages render", () => {
  it("my day, leads, a lead, calendar and performance", async () => {
    as(people.d2, "designer");
    const day = await html((await import("../../src/app/designer/page")).default({ searchParams: Promise.resolve({}) }));
    expect(day).toContain("Waiting for you");
    expect(day).toContain("Accept");
    expect(day).not.toContain(leads.a.phone);

    const list = await html((await import("../../src/app/designer/leads/page")).default({ searchParams: Promise.resolve({}) }));
    expect(list).toContain("Asha Kulkarni");
    expect(list).toContain("Eshan Patil");
    expect(list).not.toContain("Deepa Nair");
    expect(list).not.toMatch(/\+91980000010\d/);

    const detail = await html(
      (await import("../../src/app/designer/leads/[id]/page")).default({ params: Promise.resolve({ id: leads.a.enquiry }), searchParams: Promise.resolve({}) }),
    );
    expect(detail).toContain(`tel:${leads.a.phone}`);
    expect(detail).toContain("Couple redoing kitchen and living room in Baner");
    expect(detail).toContain("[budget detail removed]");
    expect(detail).not.toMatch(/18 ?lakh/i);
    expect(detail).not.toMatch(/>Budget</);

    const calendar = await html((await import("../../src/app/designer/calendar/page")).default({ searchParams: Promise.resolve({}) }));
    expect(calendar).toContain("Scheduled consultations");
    expect(calendar).not.toContain("/dashboard/");

    const perf = await html((await import("../../src/app/designer/performance/page")).default({ searchParams: Promise.resolve({}) }));
    expect(perf).toContain("Median accept time");
    expect(perf).not.toMatch(/₹|Rs\b/);
  });

  it("another designer's lead is a 404", async () => {
    as(people.d3, "designer");
    const { default: Lead } = await import("../../src/app/designer/leads/[id]/page");
    await expect(Lead({ params: Promise.resolve({ id: leads.a.enquiry }), searchParams: Promise.resolve({}) })).rejects.toThrow(/404|NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK/);
  });
});
