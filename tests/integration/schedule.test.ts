import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_DURATION_MIN, mondayOf, placeOverlaps, schedule, scopeSummary } from "../../src/lib/dashboard/schedule";
import { rebuildTestSchema, TEST_SCHEMA, testSql } from "./helpers";

const sql = testSql();
const t = (table: string) => sql(`${TEST_SCHEMA}.${table}`);

// A week far from the seed and fixture data: Monday 4 March 2030 to Sunday 10 March 2030 (IST).
const WEEK = "2030-03-04";
const NEXT_WEEK = "2030-03-11";
const at = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);

let anika = "";
let rohan = "";
let meera = "";
let callForOverlapA = "";
let n = 0;

async function designer(name: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`insert into ${t("staff")} (name, role) values (${name}, 'designer') returning id`;
  return row.id;
}

async function booking(opts: {
  start: Date;
  end?: Date;
  designerId: string | null;
  type?: "studio" | "site" | "principal";
  status?: "booked" | "rescheduled" | "cancelled";
  name?: string;
  facts?: Record<string, unknown>;
  withCall?: boolean;
}): Promise<{ bookingId: string; callId: string | null }> {
  n += 1;
  const phone = `+9198765${String(n).padStart(5, "0")}`;
  const [caller] = await sql<{ id: string }[]>`insert into ${t("callers")} (phone_e164, name) values (${phone}, ${opts.name ?? `Caller ${n}`}) returning id`;
  const [enquiry] = await sql<{ id: string }[]>`
    insert into ${t("enquiries")} (caller_id, facts, consult_type, assigned_designer_id)
    values (${caller.id}, ${sql.json((opts.facts ?? { locality: "Baner" }) as never)}, ${opts.type ?? "studio"}, ${opts.designerId}) returning id`;
  let callId: string | null = null;
  if (opts.withCall) {
    await sql`insert into ${t("calls")} (vaani_call_id, enquiry_id, caller_id, started_at) values (${`schedule-old-${n}`}, ${enquiry.id}, ${caller.id}, ${new Date(opts.start.getTime() - 3 * 86_400_000)})`;
    const [call] = await sql<{ id: string }[]>`
      insert into ${t("calls")} (vaani_call_id, enquiry_id, caller_id, started_at) values (${`schedule-${n}`}, ${enquiry.id}, ${caller.id}, ${new Date(opts.start.getTime() - 86_400_000)}) returning id`;
    callId = call.id;
  }
  const [row] = await sql<{ id: string }[]>`
    insert into ${t("bookings")} (enquiry_id, calcom_uid, consult_type, start_at, end_at, designer_id, status)
    values (${enquiry.id}, ${`schedule-uid-${n}`}, ${opts.type ?? "studio"}, ${opts.start}, ${opts.end ?? null}, ${opts.designerId}, ${opts.status ?? "booked"}) returning id`;
  return { bookingId: row.id, callId };
}

beforeAll(async () => {
  rebuildTestSchema();
  anika = await designer("Anika Schedule");
  rohan = await designer("Rohan Schedule");
  meera = await designer("Meera Schedule");

  // Two overlapping meetings for Anika on Tuesday, and a third chained onto the second.
  callForOverlapA = (await booking({ start: at("2030-03-05", "10:00"), end: at("2030-03-05", "11:00"), designerId: anika, name: "Overlap A", withCall: true })).callId!;
  await booking({ start: at("2030-03-05", "10:30"), designerId: anika, type: "site", name: "Overlap B", facts: { locality: "Kothrud", scope_text: "full 3BHK, budget ₹12 lakh", property_kind: "apartment", sqft: 1400 } });
  await booking({ start: at("2030-03-05", "11:30"), end: at("2030-03-05", "12:00"), designerId: anika, name: "Overlap C" });
  // Rohan: a cancelled and a rescheduled meeting.
  await booking({ start: at("2030-03-06", "15:00"), designerId: rohan, status: "cancelled", name: "Cancelled Caller" });
  await booking({ start: at("2030-03-07", "17:00"), designerId: rohan, type: "principal", status: "rescheduled", name: "Moved Caller" });
  // Meera: IST week edges.
  await booking({ start: at(WEEK, "00:00"), end: at(WEEK, "00:30"), designerId: meera, name: "Monday Midnight" });
  await booking({ start: at("2030-03-10", "23:30"), end: at("2030-03-10", "23:59"), designerId: meera, name: "Sunday Late" });
  await booking({ start: at(NEXT_WEEK, "00:00"), designerId: meera, name: "Next Monday" });
  await booking({ start: at("2030-03-03", "23:00"), end: at("2030-03-03", "23:59"), designerId: meera, name: "Previous Sunday" });
  // Unassigned.
  await booking({ start: at("2030-03-08", "12:00"), designerId: null, type: "site", name: "No Designer" });
}, 300_000);

afterAll(async () => {
  await sql.end();
});

describe("schedule", () => {
  it("returns the IST week, earliest first, with every designer and the unassigned booking", async () => {
    const rows = await schedule(sql, TEST_SCHEMA, WEEK, NEXT_WEEK);
    const names = rows.map((row) => row.caller_name);
    expect(names).toEqual(["Monday Midnight", "Overlap A", "Overlap B", "Overlap C", "Cancelled Caller", "Moved Caller", "No Designer", "Sunday Late"]);
    expect(new Set(rows.map((row) => row.designer_name))).toEqual(new Set(["Anika Schedule", "Rohan Schedule", "Meera Schedule", null]));
  });

  it("buckets by IST date, not UTC date", async () => {
    const rows = await schedule(sql, TEST_SCHEMA, WEEK, NEXT_WEEK);
    expect(rows.find((row) => row.caller_name === "Monday Midnight")?.day).toBe(WEEK);
    expect(rows.find((row) => row.caller_name === "Sunday Late")?.day).toBe("2030-03-10");
    expect(names(await schedule(sql, TEST_SCHEMA, NEXT_WEEK, "2030-03-18"))).toEqual(["Next Monday"]);
    expect(mondayOf("2030-03-10")).toBe(WEEK);
    expect(mondayOf(WEEK)).toBe(WEEK);
  });

  it("fills a missing end time from the per-type default", async () => {
    const rows = await schedule(sql, TEST_SCHEMA, WEEK, NEXT_WEEK);
    const site = rows.find((row) => row.caller_name === "Overlap B")!;
    expect((site.end.getTime() - site.start.getTime()) / 60_000).toBe(DEFAULT_DURATION_MIN.site);
    const kept = rows.find((row) => row.caller_name === "Overlap A")!;
    expect((kept.end.getTime() - kept.start.getTime()) / 60_000).toBe(60);
  });

  it("keeps cancelled and rescheduled bookings with their status", async () => {
    const rows = await schedule(sql, TEST_SCHEMA, WEEK, NEXT_WEEK);
    expect(rows.find((row) => row.caller_name === "Cancelled Caller")?.status).toBe("cancelled");
    expect(rows.find((row) => row.caller_name === "Moved Caller")).toMatchObject({ status: "rescheduled", consult_type: "principal" });
  });

  it("links the latest call for the enquiry and masks phone numbers", async () => {
    const rows = await schedule(sql, TEST_SCHEMA, WEEK, NEXT_WEEK);
    const a = rows.find((row) => row.caller_name === "Overlap A")!;
    expect(a.call_id).toBe(callForOverlapA);
    expect(rows.filter((row) => row.caller_name === "Overlap A")).toHaveLength(1);
    expect(rows.find((row) => row.caller_name === "Overlap C")?.call_id).toBeNull();
    expect(a.phone_masked).toMatch(/^\+91 ••••• •\d{4}$/);
    expect(JSON.stringify(rows)).not.toMatch(/\+919876\d{5}/);
  });

  it("never surfaces a price from the caller's scope", async () => {
    const rows = await schedule(sql, TEST_SCHEMA, WEEK, NEXT_WEEK);
    const b = rows.find((row) => row.caller_name === "Overlap B")!;
    expect(b.locality).toBe("Kothrud");
    expect(b.scope).toBe("Apartment · 1,400 sq ft");
    expect(JSON.stringify(rows)).not.toMatch(/lakh|₹/);
    expect(scopeSummary({ full_home: true, scope_text: "modular kitchen and wardrobes" })).toBe("full home · modular kitchen and wardrobes");
  });

  it("filters by designer and ignores a malformed designer id", async () => {
    const anikaRows = await schedule(sql, TEST_SCHEMA, WEEK, NEXT_WEEK, anika);
    expect(anikaRows.map((row) => row.caller_name)).toEqual(["Overlap A", "Overlap B", "Overlap C"]);
    expect(anikaRows.every((row) => row.designer_id === anika)).toBe(true);
    expect(await schedule(sql, TEST_SCHEMA, WEEK, NEXT_WEEK, rohan)).toHaveLength(2);
    expect(await schedule(sql, TEST_SCHEMA, WEEK, NEXT_WEEK, "not-a-uuid")).toHaveLength(8);
  });

  it("places overlapping meetings side by side", async () => {
    const rows = (await schedule(sql, TEST_SCHEMA, WEEK, NEXT_WEEK, anika)).filter((row) => row.day === "2030-03-05");
    const placed = placeOverlaps(rows).map((entry) => [entry.item.caller_name, entry.lane, entry.lanes]);
    // A 10:00-11:00, B 10:30-12:00, C 11:30-12:00: one chained cluster of two lanes; C reuses A's lane.
    expect(placed).toEqual([
      ["Overlap A", 0, 2],
      ["Overlap B", 1, 2],
      ["Overlap C", 0, 2],
    ]);
    const solo = placeOverlaps(rows.slice(0, 1));
    expect(solo[0]).toMatchObject({ lane: 0, lanes: 1 });
  });
});

const names = (rows: { caller_name: string | null }[]) => rows.map((row) => row.caller_name);
