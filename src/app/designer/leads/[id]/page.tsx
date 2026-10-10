import Link from "next/link";
import { notFound } from "next/navigation";
import { rawSql } from "@/db/client";
import { SCHEMA_NAME } from "@/db/schema";
import { requireDesignerView } from "@/lib/designer/access";
import { withAs } from "@/lib/designer/links";
import { noteView } from "@/lib/designer/note";
import { leadDetail } from "@/lib/designer/queries";
import { redactPrices } from "@/lib/designer/redact";
import { Badge, buttonPrimary, Card, OUTCOME_LABEL, OUTCOME_TONE, renderedAt } from "../../../dashboard/ui";
import { AcceptButton, CONSULT_LABEL, Empty, Flash, istWhen, NoteCard, ResultBadge, ResultButtons, ViewAsBanner } from "../../ui";

export const dynamic = "force-dynamic";

const FLAG_TEXT: Record<string, string> = {
  referral: "Referral",
  frustrated: "Was frustrated on the call",
  tight_timeline: "Tight timeline",
  repeat_caller: "Has called before",
};

// "+919800000101" -> "+91 98000 00101", easier to read out; the tel: link keeps the raw number.
const spaced = (e164: string) => e164.replace(/^\+91(\d{5})(\d{5})$/, "+91 $1 $2");
const duration = (seconds: number | null) => (seconds ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : null);

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ as?: string; done?: string; by?: string }> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const view = await requireDesignerView(query.as);
  const { designer, readOnly, as } = view;
  const now = renderedAt();
  const lead = await leadDetail(rawSql(), SCHEMA_NAME, designer.id, id, now);
  if (!lead) notFound();
  const note = noteView(lead.handoff?.note);
  const back = `/designer/leads/${lead.enquiryId}`;
  const flags = lead.flags.map((flag) => FLAG_TEXT[flag]).filter(Boolean);
  const upcoming = lead.bookings.find((booking) => booking.status !== "cancelled" && booking.startAt.getTime() > now.getTime());
  // The full number only for the designer who owns the lead (they have to call); masked otherwise,
  // including for an admin viewing as them.
  const phone = !readOnly && lead.phone ? lead.phone : null;

  return (
    <main className="flex flex-col gap-6">
      <ViewAsBanner view={view} />
      <Flash done={query.done} by={query.by} />
      <Link href={withAs("/designer/leads", as)} className="w-fit rounded-full text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline">
        ← My leads
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={OUTCOME_TONE[lead.outcome] ?? "neutral"}>{OUTCOME_LABEL[lead.outcome] ?? lead.outcome}</Badge>
            <ResultBadge result={lead.result} />
            {!lead.owned && <Badge tone="info">Open to you, not accepted yet</Badge>}
          </div>
          <h1 className="text-3xl font-light tracking-tight break-words text-ink">{lead.callerName ?? "Unknown caller"}</h1>
          <p className="text-sm text-ink-muted">
            {[lead.locality, lead.consultType ? CONSULT_LABEL[lead.consultType] : null, `Enquiry ${istWhen(lead.createdAt)}`].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {phone ? (
            <a href={`tel:${phone}`} className={`${buttonPrimary} inline-flex items-center gap-2 font-mono`}>
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6.5 3.5h-2a1 1 0 0 0-1 1c0 6.6 5.4 12 12 12a1 1 0 0 0 1-1v-2l-3-1.5-1.5 1.5a8 8 0 0 1-5-5L8.5 7 7 3.5z" />
              </svg>
              <span className="sr-only">Call </span>
              {spaced(phone)}
            </a>
          ) : (
            <span className="rounded-full border border-line bg-surface px-4 py-2 font-mono text-sm text-ink-muted">{lead.phoneMasked ?? "No caller ID"}</span>
          )}
          {lead.handoff?.acceptable && <AcceptButton handoffId={lead.handoff.id} back={back} readOnly={readOnly} />}
        </div>
      </div>
      {!lead.owned && <p className="text-sm text-ink-soft">The full number appears here once you accept this handoff.</p>}

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card title="Handoff note">
          {note ? <NoteCard note={note} /> : <Empty>No note was written for this enquiry.</Empty>}
          {flags.length > 0 && (
            <ul className="mt-5 flex flex-wrap gap-2">
              {flags.map((flag) => (
                <li key={flag}>
                  <Badge tone="warn">{flag}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="flex min-w-0 flex-col gap-6">
          <Card title="Consultation">
            {lead.bookings.length === 0 ? (
              <Empty>Not booked yet.</Empty>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {lead.bookings.map((booking) => (
                  <li key={booking.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
                    <span className="flex flex-col gap-0.5">
                      <span className={`tabular-nums ${booking.status === "cancelled" ? "text-ink-soft line-through" : "text-ink"}`}>{istWhen(booking.startAt)}</span>
                      <span className="text-xs text-ink-soft">
                        {CONSULT_LABEL[booking.consultType] ?? "Consultation"} · with {booking.designer ?? "no designer yet"}
                      </span>
                    </span>
                    {booking.status !== "booked" ? <Badge tone={booking.status === "rescheduled" ? "warn" : "neutral"}>{booking.status === "rescheduled" ? "Rescheduled" : "Cancelled"}</Badge> : booking === upcoming ? <Badge tone="accent">Upcoming</Badge> : null}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-5 border-t border-line pt-5">
              {lead.result ? (
                <p className="text-sm text-ink-muted">
                  Result recorded: <ResultBadge result={lead.result} />
                  {lead.resultAt ? <span className="text-ink-soft"> · {istWhen(lead.resultAt)}</span> : null}
                </p>
              ) : lead.canRecordResult ? (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-ink-muted">How did the consultation go? This also updates the Telegram message and the CRM.</p>
                  <ResultButtons enquiryId={lead.enquiryId} back={back} readOnly={readOnly} />
                </div>
              ) : (
                <p className="text-sm text-ink-soft">{lead.owned ? "Won and Lost open once the consultation has taken place." : "Accept the handoff to take this lead on."}</p>
              )}
            </div>
          </Card>

          <Card title="Handoff">
            {lead.handoff ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-ink-soft">Assigned to</dt>
                <dd className="text-ink">{lead.assignedTo ?? "Unassigned"}</dd>
                <dt className="text-ink-soft">Posted</dt>
                <dd className="text-ink tabular-nums">{lead.handoff.postedAt ? istWhen(lead.handoff.postedAt) : "Not posted yet"}</dd>
                <dt className="text-ink-soft">Accepted</dt>
                <dd className="text-ink tabular-nums">{lead.handoff.acceptedAt ? `${istWhen(lead.handoff.acceptedAt)} by ${lead.handoff.acceptedBy ?? "a designer"}` : "Not yet"}</dd>
                {lead.handoff.escalated && (
                  <>
                    <dt className="text-ink-soft">Escalated</dt>
                    <dd>
                      <Badge tone="danger">Escalated to the founder</Badge>
                    </dd>
                  </>
                )}
              </dl>
            ) : (
              <Empty>No handoff for this enquiry.</Empty>
            )}
          </Card>
        </div>
      </div>

      <Card title="The call">
        {lead.calls.length === 0 ? (
          <Empty>No call recorded for this enquiry.</Empty>
        ) : (
          <div className="flex flex-col gap-6">
            {lead.calls.map((call, index) => (
              <article key={call.id} className="flex flex-col gap-3">
                <p className="text-xs text-ink-soft tabular-nums">
                  {call.startedAt ? istWhen(call.startedAt) : "Time not recorded"}
                  {duration(call.durationS) ? ` · ${duration(call.durationS)}` : ""}
                  {lead.calls.length > 1 ? ` · call ${lead.calls.length - index} of ${lead.calls.length}` : ""}
                </p>
                {call.summary && <p className="rounded-2xl bg-surface-2 px-4 py-3 text-sm text-ink-muted italic">{call.summary}</p>}
                {call.transcript ? (
                  <details id={index === 0 ? "transcript" : undefined} className="group rounded-2xl border border-line">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-2xl px-4 py-3 text-sm font-medium text-ink hover:bg-surface-2">
                      Transcript
                      <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 text-ink-soft transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m4 6 4 4 4-4" />
                      </svg>
                    </summary>
                    <pre className="max-h-[60vh] overflow-auto border-t border-line px-4 py-3 font-sans text-sm leading-7 whitespace-pre-wrap text-ink">{redactPrices(call.transcript)}</pre>
                  </details>
                ) : (
                  <p className="text-sm text-ink-soft">No transcript (not received yet, or removed after the retention period).</p>
                )}
              </article>
            ))}
            <p className="text-xs text-ink-soft">Any figure the caller mentioned is left out here; the budget conversation happens in the consultation.</p>
          </div>
        )}
      </Card>
    </main>
  );
}
