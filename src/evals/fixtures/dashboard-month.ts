// A fixture month (September 2026) with known answers, seeded into aangan_test. Used by the
// dashboard integration tests and the metric-reconcile eval.
import type postgres from "postgres";

export const FIXTURE_RANGE = { from: "2026-09-01", to: "2026-10-01" };

// 100 inbound calls -> 100 enquiries: 50 qualified, 30 with notes, 10 not qualified (6 on C2, 4 on C3),
// 6 needing a person, 4 not enquiries. 30 of the calls arrive outside office hours.
// 40 bookings (30 already held, 10 in December), 12 won, 6 lost.
// Cost lines total exactly Rs 6,000 of usage; fixed plans Rs 2,000 -> Rs 8,000 in all.
export const FIXTURE_EXPECTED = {
  calls: 100,
  after_hours_calls: 30,
  enquiries: 100,
  qualified: 80,
  booked: 40,
  consulted: 30,
  won: 12,
  lost: 6,
  top_failing: "C2",
  total_cost: 8000,
  per_qualified_lead: 100,
  per_call: 80,
  per_booking: 200,
  callbacks_total: 6,
  callbacks_on_time: 4,
  handoffs_posted: 80,
  escalations: 8,
};

export async function seedDashboardMonth(sql: postgres.Sql, schema: string): Promise<void> {
  const t = (name: string) => sql(`${schema}.${name}`);
  await sql.unsafe(
    ["cost_lines", "fixed_costs", "handoffs", "bookings", "tasks", "calls", "crm_links", "enquiries", "callers"]
      .map((table) => `delete from "${schema}"."${table}";`)
      .join("\n"),
  );
  const designers = await sql<{ id: string }[]>`select id from ${t("staff")} where role = 'designer' order by name`;
  const outcomes = [
    ...Array(50).fill("QUALIFIED"),
    ...Array(30).fill("QUALIFIED_WITH_NOTES"),
    ...Array(10).fill("NOT_QUALIFIED"),
    ...Array(6).fill("NEEDS_HUMAN"),
    ...Array(4).fill("NOT_ENQUIRY"),
  ];
  // Weekdays in September 2026 (1 September is a Tuesday), so only the 21:00 calls are after hours.
  const weekdays = [1, 2, 3, 4, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 28, 29, 30];
  for (let i = 0; i < 100; i += 1) {
    const day = weekdays[i % weekdays.length];
    const afterHours = i < 30;
    const hour = afterHours ? 21 : 11 + (i % 7);
    const started = `2026-09-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00+05:30`;
    const [caller] = await sql<{ id: string }[]>`insert into ${t("callers")} (phone_e164, name) values (${`+9198000${String(i).padStart(5, "0")}`}, ${`Fixture ${i}`}) returning id`;
    const outcome = outcomes[i];
    const failing = outcome === "NOT_QUALIFIED" ? (i % 10 < 6 ? "C2" : "C3") : null;
    const criteria = ["C1", "C2", "C3", "C4", "C5"].map((id) => ({ id, state: id === failing ? "fail" : "pass", reason: "", evidence: "" }));
    const designer = designers[i % designers.length]?.id ?? null;
    const [enquiry] = await sql<{ id: string }[]>`
      insert into ${t("enquiries")} (caller_id, outcome, criteria, assigned_designer_id, consult_result, created_at, updated_at)
      values (${caller.id}, ${outcome}, ${sql.json(criteria)}, ${designer}, ${i < 12 ? "won" : i < 18 ? "lost" : null}, ${started}, ${started})
      returning id`;
    const [call] = await sql<{ id: string }[]>`
      insert into ${t("calls")} (vaani_call_id, enquiry_id, caller_id, direction, started_at, ended_at, duration_s, created_at)
      values (${`fixture-${i}`}, ${enquiry.id}, ${caller.id}, 'in', ${started}, ${started}, 240, ${started}) returning id`;
    // Usage: Rs 60 per call -> Rs 6,000.
    await sql`insert into ${t("cost_lines")} (call_id, enquiry_id, kind, qty, unit_price_inr, amount_inr, recorded_at)
              values (${call.id}, ${enquiry.id}, 'agent_min', 12, 5, 60, ${started})`;
    if (i < 40) {
      const start = i < 30 ? "2026-09-25T11:00:00+05:30" : "2026-12-01T11:00:00+05:30";
      await sql`insert into ${t("bookings")} (enquiry_id, calcom_uid, consult_type, start_at, designer_id, status)
                values (${enquiry.id}, ${`fixture-booking-${i}`}, 'studio', ${start}, ${designer}, 'booked')`;
    }
    if (outcome === "QUALIFIED" || outcome === "QUALIFIED_WITH_NOTES") {
      const accepted = i < 72 ? `2026-09-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:10:00+05:30` : null;
      await sql`insert into ${t("handoffs")} (enquiry_id, posted_at, accepted_at, escalated_at, accepted_by)
                values (${enquiry.id}, ${started}, ${accepted}, ${i >= 72 ? started : null}, ${accepted ? designer : null})`;
    }
    if (outcome === "NEEDS_HUMAN") {
      const onTime = i % 6 < 4;
      await sql`insert into ${t("tasks")} (enquiry_id, kind, reason, due_at, done_at, created_at)
                values (${enquiry.id}, 'callback', 'fixture', ${started}, ${onTime ? started : `2026-09-${String(day).padStart(2, "0")}T23:00:00+05:30`}, ${started})`;
    }
  }
  await sql`insert into ${t("fixed_costs")} (month, item, amount_inr) values ('2026-09-01', 'Vaani plan', 1200), ('2026-09-01', 'Vercel Pro', 800)`;
}
