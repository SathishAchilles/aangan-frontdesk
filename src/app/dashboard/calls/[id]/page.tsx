import Link from "next/link";
import { notFound } from "next/navigation";
import { rawSql } from "@/db/client";
import { SCHEMA_NAME } from "@/db/schema";
import { maskPhone } from "@/lib/phone";
import { requireStaff } from "@/lib/auth";
import { Badge, buttonSecondary, Card, CRITERION_LABEL, inr, istTime, Notice, OUTCOME_LABEL, Table } from "../../ui";

export const dynamic = "force-dynamic";

type Criterion = { id: string; state: string; reason: string; evidence: string };

export default async function CallDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sql = rawSql();
  const s = (table: string) => sql(`${SCHEMA_NAME}.${table}`);
  const [call] = await sql<{ id: string; started_at: Date | null; ended_at: Date | null; duration_s: number | null; transcript: string | null; summary: string | null; recording_url: string | null; end_reason: string | null; dropped: boolean; grader_flags: Record<string, string[]>; enquiry_id: string | null; phone: string | null; name: string | null }[]>`
    select c.*, ca.phone_e164 as phone, ca.name from ${s("calls")} c left join ${s("callers")} ca on ca.id = c.caller_id where c.id = ${id}`;
  if (!call) notFound();
  const [enquiry] = call.enquiry_id
    ? await sql<{ outcome: string; criteria: Criterion[]; flags: string[]; consult_type: string | null; designer: string | null }[]>`
        select e.outcome, e.criteria, e.flags, e.consult_type, st.name as designer from ${s("enquiries")} e left join ${s("staff")} st on st.id = e.assigned_designer_id where e.id = ${call.enquiry_id}`
    : [];
  const bookings = call.enquiry_id ? await sql<{ start_at: Date; status: string; consult_type: string }[]>`select start_at, status, consult_type from ${s("bookings")} where enquiry_id = ${call.enquiry_id} order by created_at` : [];
  const [handoff] = call.enquiry_id ? await sql<{ posted_at: Date | null; accepted_at: Date | null; escalated_at: Date | null; accepter: string | null }[]>`select h.posted_at, h.accepted_at, h.escalated_at, st.name as accepter from ${s("handoffs")} h left join ${s("staff")} st on st.id = h.accepted_by where h.enquiry_id = ${call.enquiry_id}` : [];
  const costs = await sql<{ kind: string; qty: number; amount: number }[]>`select kind, qty::float as qty, amount_inr::float as amount from ${s("cost_lines")} where call_id = ${id} order by kind`;
  const flags = [...(call.grader_flags?.price_figure ?? []), ...(call.grader_flags?.budget_question ?? [])];

  return (
    <main className="flex flex-col gap-6">
      <Link href="/dashboard/calls" className="w-fit rounded-full text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline">
        ← Calls
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-light tracking-tight text-ink">{call.name ?? "Caller"}</h1>
        <p className="text-sm text-ink-muted">
          {call.phone ? maskPhone(call.phone) : "No caller ID"} · {istTime(call.started_at)} IST · {call.duration_s ? `${Math.floor(call.duration_s / 60)}m ${call.duration_s % 60}s` : "-"}
          {call.dropped ? " · dropped" : ""}
        </p>
      </div>
      {flags.length > 0 && <Notice tone="danger">Safety check failed on: {flags.map((line) => `“${line}”`).join("; ")}</Notice>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Outcome">
          <p className="mb-4">
            {enquiry ? (
              <Badge tone={enquiry.outcome === "QUALIFIED" || enquiry.outcome === "QUALIFIED_WITH_NOTES" ? "accent" : "neutral"}>{OUTCOME_LABEL[enquiry.outcome] ?? enquiry.outcome}</Badge>
            ) : (
              <span className="text-sm text-ink-muted">Not linked to an enquiry</span>
            )}
          </p>
          {enquiry && (
            <Table
              head={["Check", "State", "Caller's words"]}
              rows={(Array.isArray(enquiry.criteria) ? enquiry.criteria : []).map((criterion) => [CRITERION_LABEL[criterion.id] ?? criterion.id, criterion.state.replace("_", " "), criterion.evidence || criterion.reason])}
            />
          )}
          {enquiry?.flags?.length ? <p className="mt-3 text-xs text-ink-soft">Flags: {enquiry.flags.join(", ")}</p> : null}
        </Card>
        <Card title="Booking and handoff">
          <Table head={["Consultation", "Type", "Status"]} rows={bookings.map((booking) => [istTime(booking.start_at), booking.consult_type, booking.status])} empty="No booking." />
          <p className="mt-4 rounded-2xl bg-surface-2 px-4 py-3 text-sm text-ink-muted">
            Designer: {enquiry?.designer ?? "-"} · Posted {istTime(handoff?.posted_at ?? null)} · Accepted {handoff?.accepted_at ? `${istTime(handoff.accepted_at)} by ${handoff.accepter}` : "no"}
            {handoff?.escalated_at ? " · escalated" : ""}
          </p>
        </Card>
      </div>
      <Card title="Cost of this call">
        <Table head={["Item", "Quantity", "Amount"]} rows={costs.map((cost) => [<span key="k" className="font-mono text-xs">{cost.kind}</span>, cost.qty, inr(cost.amount)])} empty="No costs recorded yet." />
      </Card>
      <Card title="Transcript">
        {call.summary && <p className="mb-4 rounded-2xl bg-surface-2 px-4 py-3 text-sm text-ink-muted italic">{call.summary}</p>}
        {call.recording_url && (
          <p className="mb-4 text-sm">
            <a className={buttonSecondary + " inline-block"} href={call.recording_url} rel="noreferrer" target="_blank">
              Recording
            </a>
          </p>
        )}
        <pre className="max-h-[70vh] overflow-auto font-sans text-sm leading-7 whitespace-pre-wrap text-ink">{call.transcript ?? "No transcript (not received yet, or removed after the retention period)."}</pre>
      </Card>
    </main>
  );
}
