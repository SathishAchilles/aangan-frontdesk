import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attention, istDayStart, today } from "../../src/lib/dashboard/attention";
import { rebuildTestSchema, seedTestSchema, TEST_SCHEMA, testSql } from "./helpers";

const sql = testSql();
const t = (name: string) => sql(`${TEST_SCHEMA}.${name}`);

// Wednesday 14 October 2026, 15:00 IST: inside office hours.
const NOW = new Date("2026-10-14T15:00:00+05:30");
const SETTINGS = { acceptEscalateMin: 30, office: { start: "10:00", end: "19:00", days: ["mon", "tue", "wed", "thu", "fri"] as ("mon" | "tue" | "wed" | "thu" | "fri")[] } };
const min = (n: number) => new Date(NOW.getTime() + n * 60_000);
const YESTERDAY = min(-24 * 60);

let phoneSeq = 0;
let designerId: string | null = null;

async function clear() {
  await sql.unsafe(
    ["cost_lines", "fixed_costs", "handoffs", "bookings", "tasks", "calls", "crm_links", "enquiries", "callers"]
      .map((table) => `delete from "${TEST_SCHEMA}"."${table}";`)
      .join("\n"),
  );
}

// A caller with one enquiry and one call, all at `at`.
async function lead(name: string, at: Date, outcome = "NOT_QUALIFIED", flags: Record<string, string[]> = {}) {
  phoneSeq += 1;
  const [caller] = await sql<{ id: string }[]>`insert into ${t("callers")} (phone_e164, name) values (${`+9197000${String(phoneSeq).padStart(5, "0")}`}, ${name}) returning id`;
  const [enquiry] = await sql<{ id: string }[]>`
    insert into ${t("enquiries")} (caller_id, outcome, assigned_designer_id, created_at, updated_at)
    values (${caller.id}, ${outcome}, ${designerId}, ${at}, ${at}) returning id`;
  const [call] = await sql<{ id: string }[]>`
    insert into ${t("calls")} (vaani_call_id, enquiry_id, caller_id, direction, started_at, ended_at, duration_s, grader_flags, created_at)
    values (${`attention-${phoneSeq}`}, ${enquiry.id}, ${caller.id}, 'in', ${at}, ${at}, 120, ${sql.json(flags)}, ${at}) returning id`;
  return { enquiryId: enquiry.id, callId: call.id };
}

async function handoff(enquiryId: string, postedAt: Date | null, opts: { acceptedAt?: Date; escalatedAt?: Date } = {}) {
  const [row] = await sql<{ id: string }[]>`
    insert into ${t("handoffs")} (enquiry_id, posted_at, accepted_at, escalated_at)
    values (${enquiryId}, ${postedAt}, ${opts.acceptedAt ?? null}, ${opts.escalatedAt ?? null}) returning id`;
  return row.id;
}

async function task(kind: string, opts: { enquiryId?: string | null; dueAt?: Date | null; doneAt?: Date | null; payload?: Record<string, unknown> } = {}) {
  const [row] = await sql<{ id: string }[]>`
    insert into ${t("tasks")} (enquiry_id, kind, reason, payload, due_at, done_at, created_at)
    values (${opts.enquiryId ?? null}, ${kind}, ${`${kind} task`}, ${sql.json((opts.payload ?? {}) as never)}, ${opts.dueAt ?? null}, ${opts.doneAt ?? null}, ${YESTERDAY}) returning id`;
  return row.id;
}

async function booking(enquiryId: string, startAt: Date, status = "booked", createdAt = min(-60)) {
  phoneSeq += 1;
  const [row] = await sql<{ id: string }[]>`
    insert into ${t("bookings")} (enquiry_id, calcom_uid, consult_type, start_at, designer_id, status, created_at)
    values (${enquiryId}, ${`attention-booking-${phoneSeq}`}, 'studio', ${startAt}, ${designerId}, ${status}, ${createdAt}) returning id`;
  return row.id;
}

beforeAll(async () => {
  rebuildTestSchema();
  seedTestSchema();
  await clear();
  const [designer] = await sql<{ id: string }[]>`select id from ${t("staff")} where role = 'designer' order by name limit 1`;
  designerId = designer?.id ?? null;
}, 300_000);

afterAll(async () => {
  await sql.end();
});

describe("istDayStart", () => {
  it("returns midnight IST of the IST day", () => {
    expect(istDayStart(NOW).toISOString()).toBe("2026-10-13T18:30:00.000Z");
    expect(istDayStart(new Date("2026-10-14T00:05:00+05:30")).toISOString()).toBe("2026-10-13T18:30:00.000Z");
    expect(istDayStart(new Date("2026-10-13T23:55:00+05:30")).toISOString()).toBe("2026-10-12T18:30:00.000Z");
  });
});

describe("needs attention", () => {
  it("is empty when nothing is waiting", async () => {
    expect(await attention(sql, TEST_SCHEMA, NOW, SETTINGS)).toEqual([]);
    expect(await today(sql, TEST_SCHEMA, NOW)).toEqual({ calls: 0, qualified: 0, booked: 0 });
  });

  describe("with rows in every category", () => {
    const ids: Record<string, string> = {};
    const calls: Record<string, string> = {};

    beforeAll(async () => {
      // Handoffs.
      const a = await lead("Escalated Asha", YESTERDAY, "QUALIFIED");
      ids.escalated = await handoff(a.enquiryId, min(-90), { escalatedAt: min(-60) });
      // Escalated long ago and never accepted: stale, so it stays off the panel.
      const stale = await lead("Stale Escalation", new Date(NOW.getTime() - 20 * 86_400_000), "QUALIFIED");
      await handoff(stale.enquiryId, new Date(NOW.getTime() - 20 * 86_400_000), { escalatedAt: new Date(NOW.getTime() - 20 * 86_400_000 + 3_600_000) });
      calls.escalated = a.callId;
      const night = await lead("Overnight Om", YESTERDAY, "QUALIFIED");
      ids.overnight = await handoff(night.enquiryId, new Date("2026-10-13T19:30:00+05:30")); // after hours yesterday
      const b = await lead("Overdue Bina", YESTERDAY, "QUALIFIED");
      ids.overdue = await handoff(b.enquiryId, min(-45));
      const c = await lead("Waiting Chetan", YESTERDAY, "QUALIFIED");
      ids.waiting = await handoff(c.enquiryId, min(-10));
      const c2 = await lead("Waiting Charu", YESTERDAY, "QUALIFIED");
      ids.waiting2 = await handoff(c2.enquiryId, min(-5));
      const d = await lead("Accepted Dev", YESTERDAY, "QUALIFIED");
      await handoff(d.enquiryId, min(-20), { acceptedAt: min(-15) });
      const e = await lead("Unposted Esha", YESTERDAY, "QUALIFIED");
      await handoff(e.enquiryId, null);

      // Callbacks.
      const f = await lead("Late Farah", YESTERDAY, "NEEDS_HUMAN");
      ids.callbackLate = await task("callback", { enquiryId: f.enquiryId, dueAt: min(-20), payload: { call_id: f.callId } });
      calls.callbackLate = f.callId;
      const g = await lead("Soon Gopal", YESTERDAY, "NEEDS_HUMAN");
      ids.callbackSoon = await task("callback", { enquiryId: g.enquiryId, dueAt: min(60) }); // no call_id: falls back to the enquiry's call
      calls.callbackSoon = g.callId;
      await task("callback", { enquiryId: g.enquiryId, dueAt: min(5 * 60) }); // later than two hours
      await task("callback", { enquiryId: f.enquiryId, dueAt: min(-120), doneAt: min(-100) }); // done

      // Existing-client complaints: no enquiry, only a phone in the payload.
      ids.complaint = await task("urgent", { dueAt: min(15), payload: { phone: "+919812345678", summary: "Leaking sink" } });
      await task("urgent", { dueAt: min(-300), doneAt: min(-200), payload: { phone: "+919812345679" } });

      // Safety flags.
      const l = await lead("Flagged Lata", min(-26 * 60), "QUALIFIED", { price_figure: ["it would be about 5 lakh"], budget_question: ["what is your budget"] });
      ids.safety = l.callId;
      await lead("Old Flag", min(-10 * 24 * 60), "QUALIFIED", { price_figure: ["old line"], budget_question: [] });
      const n = await lead("Closed Flag", min(-27 * 60), "QUALIFIED", { price_figure: ["closed line"], budget_question: [] });
      await task("alert", { payload: { call_id: n.callId }, doneAt: min(-60) });
      await lead("Clean Call", min(-25 * 60), "QUALIFIED", { price_figure: [], budget_question: [] });

      // Consultations.
      const o = await lead("Today Omkar", YESTERDAY, "QUALIFIED");
      ids.consultToday = await booking(o.enquiryId, min(120));
      calls.consultToday = o.callId;
      // Earlier today and already over: nothing to act on, so it stays off the panel.
      const earlier = await lead("Earlier Esha", YESTERDAY, "QUALIFIED");
      await booking(earlier.enquiryId, min(-180), "booked", YESTERDAY);
      const p = await lead("Tomorrow Priya", YESTERDAY, "QUALIFIED");
      ids.consultTomorrow = await booking(p.enquiryId, new Date("2026-10-15T11:00:00+05:30"));
      const q = await lead("Cancelled Qadir", YESTERDAY, "QUALIFIED");
      await booking(q.enquiryId, new Date("2026-10-15T12:00:00+05:30"), "cancelled");
      const r = await lead("Later Rhea", YESTERDAY, "QUALIFIED");
      await booking(r.enquiryId, new Date("2026-10-17T11:00:00+05:30"), "booked", YESTERDAY);

      // Today's activity, including both sides of IST midnight.
      await lead("Today One", min(-120), "QUALIFIED");
      await lead("Today Two", min(-60), "QUALIFIED_WITH_NOTES");
      await lead("Today Three", min(-30), "NOT_QUALIFIED");
      await lead("Just After Midnight", new Date("2026-10-14T00:05:00+05:30"), "NOT_ENQUIRY");
      await lead("Just Before Midnight", new Date("2026-10-13T23:55:00+05:30"), "QUALIFIED");
    });

    it("lists every category, most urgent first", async () => {
      const items = await attention(sql, TEST_SCHEMA, NOW, SETTINGS);
      expect(items.map((item) => [item.kind, item.id])).toEqual([
        ["handoff_escalated", ids.escalated],
        ["handoff_overdue", ids.overnight],
        ["handoff_overdue", ids.overdue],
        ["callback_overdue", ids.callbackLate],
        ["complaint", ids.complaint],
        ["safety_flag", ids.safety],
        ["handoff_waiting", ids.waiting],
        ["handoff_waiting", ids.waiting2],
        ["callback_due", ids.callbackSoon],
        ["consult_today", ids.consultToday],
        ["consult_tomorrow", ids.consultTomorrow],
      ]);
    });

    it("links each item to its call and reports minutes", async () => {
      const items = await attention(sql, TEST_SCHEMA, NOW, SETTINGS);
      const byId = new Map(items.map((item) => [item.id, item]));
      expect(byId.get(ids.escalated)).toMatchObject({ tone: "danger", minutes: 90, callId: calls.escalated });
      expect(byId.get(ids.overdue)).toMatchObject({ tone: "danger", minutes: 45 });
      expect(byId.get(ids.overdue)?.detail).toContain("30 min");
      expect(byId.get(ids.waiting)).toMatchObject({ tone: "warn", minutes: 10 });
      expect(byId.get(ids.callbackLate)).toMatchObject({ minutes: 20, callId: calls.callbackLate });
      expect(byId.get(ids.callbackSoon)).toMatchObject({ minutes: -60, callId: calls.callbackSoon });
      expect(byId.get(ids.complaint)).toMatchObject({ callId: null });
      expect(byId.get(ids.safety)).toMatchObject({ callId: ids.safety });
      expect(byId.get(ids.consultToday)).toMatchObject({ tone: "info", callId: calls.consultToday });
    });

    it("masks phones and never shows flagged lines", async () => {
      const text = JSON.stringify(await attention(sql, TEST_SCHEMA, NOW, SETTINGS));
      expect(text).toContain("+91 ••••• •5678");
      expect(text).not.toContain("+919812345678");
      expect(text).not.toMatch(/lakh|what is your budget/);
      expect(text).toContain("price figure (1)");
    });

    it("counts only office minutes towards the accept limit", async () => {
      // At 10:10 the overnight handoff has waited 14 hours but only 10 office minutes.
      const morning = await attention(sql, TEST_SCHEMA, new Date("2026-10-14T10:10:00+05:30"), SETTINGS);
      expect(morning.find((item) => item.id === ids.overnight)).toMatchObject({ kind: "handoff_waiting", tone: "warn" });
    });

    it("counts today's calls, qualified enquiries and bookings in IST", async () => {
      expect(await today(sql, TEST_SCHEMA, NOW)).toEqual({ calls: 4, qualified: 2, booked: 2 });
    });
  });
});
