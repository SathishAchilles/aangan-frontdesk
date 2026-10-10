import Link from "next/link";
import type { ReactNode } from "react";
import { rawSql } from "@/db/client";
import { SCHEMA_NAME } from "@/db/schema";
import { addDays, istDate, schedule, type Meeting } from "@/lib/dashboard/schedule";
import { requireDesignerView } from "@/lib/designer/access";
import { withAs } from "@/lib/designer/links";
import { type Activity, bookingLeads, myCallbacks, myLeads, recentActivity, waitingHandoffs } from "@/lib/designer/queries";
import { Badge, buttonSecondary, Card, PageHeader, relTime, renderedAt, Stat } from "../dashboard/ui";
import { AcceptButton, CONSULT_LABEL, Empty, firstName, Flash, istDay, istHm, istWhen, SectionTitle, ViewAsBanner } from "./ui";

export const dynamic = "force-dynamic";

type Params = { as?: string; done?: string; by?: string };

const greeting = (now: Date) => {
  const hour = Number(istHm(now).slice(0, 2));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
};

const ACTIVITY: Record<Activity["kind"], { text: string; dot: string }> = {
  handoff: { text: "New handoff", dot: "bg-info" },
  accepted: { text: "Accepted", dot: "bg-accent" },
  booked: { text: "Consultation booked", dot: "bg-chart-2" },
  rescheduled: { text: "Consultation rescheduled", dot: "bg-warn" },
  cancelled: { text: "Consultation cancelled", dot: "bg-ink-soft" },
  won: { text: "Won", dot: "bg-ok" },
  lost: { text: "Lost", dot: "bg-ink-soft" },
};

function ConsultList({ title, meetings, leads, as, empty }: { title: string; meetings: Meeting[]; leads: Map<string, string>; as: string | null; empty: string }) {
  const shown = meetings.filter((meeting) => meeting.status !== "cancelled");
  return (
    <Card>
      <SectionTitle title={title} hint={shown.length === 0 ? undefined : `${shown.length} booked`} />
      {shown.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {shown.map((meeting) => {
            const lead = leads.get(meeting.id);
            const name = meeting.caller_name ?? "Unknown caller";
            return (
              <li key={meeting.id} className="flex items-start gap-4 py-3 first:pt-0 last:pb-0">
                <span className="w-14 shrink-0 text-lg font-light text-ink tabular-nums">{istHm(meeting.start)}</span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  {lead ? (
                    <Link href={withAs(`/designer/leads/${lead}`, as)} className="truncate font-medium text-ink underline-offset-4 hover:underline">
                      {name}
                    </Link>
                  ) : (
                    <span className="truncate font-medium text-ink">{name}</span>
                  )}
                  <span className="truncate text-sm text-ink-muted">
                    {CONSULT_LABEL[meeting.consult_type]}
                    {meeting.locality ? ` · ${meeting.locality}` : ""}
                  </span>
                  {meeting.scope && <span className="truncate text-xs text-ink-soft">{meeting.scope}</span>}
                </span>
                {meeting.status === "rescheduled" && <Badge tone="warn">Rescheduled</Badge>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export default async function MyDay({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const view = await requireDesignerView(params.as);
  const { designer, readOnly, as } = view;
  const sql = rawSql();
  const now = renderedAt();
  const today = istDate(now);
  const tomorrow = addDays(today, 1);
  const [waiting, meetings, callbacks, activity, leads] = await Promise.all([
    waitingHandoffs(sql, SCHEMA_NAME, designer.id, now),
    schedule(sql, SCHEMA_NAME, today, addDays(today, 2), designer.id),
    myCallbacks(sql, SCHEMA_NAME, designer.id),
    recentActivity(sql, SCHEMA_NAME, designer.id, now),
    myLeads(sql, SCHEMA_NAME, designer.id, now),
  ]);
  const leadOf = await bookingLeads(sql, SCHEMA_NAME, meetings.map((meeting) => meeting.id));
  const todays = meetings.filter((meeting) => meeting.day === today);
  const tomorrows = meetings.filter((meeting) => meeting.day === tomorrow);
  const nextToday = todays.find((meeting) => meeting.status !== "cancelled" && meeting.end.getTime() > now.getTime());
  const forMe = waiting.filter((handoff) => handoff.forMe).length;
  const needResult = leads.filter((lead) => lead.needsResult).length;
  const dueCallbacks = callbacks.filter((task) => task.dueAt && task.dueAt.getTime() <= now.getTime()).length;

  const tiles: ReactNode[] = [
    <Stat
      key="today"
      tone="accent"
      label="Consultations today"
      value={todays.filter((meeting) => meeting.status !== "cancelled").length}
      hint={nextToday ? `Next at ${istHm(nextToday.start)} · ${CONSULT_LABEL[nextToday.consult_type]}` : "Nothing more booked today"}
      href={withAs("/designer/calendar?view=day", as)}
    />,
    <Stat key="waiting" label="Waiting for you" value={waiting.length} hint={waiting.length === 0 ? "No handoffs waiting" : `${forMe} assigned to you · ${waiting.length - forMe} open to you`} href="#waiting" />,
    <Stat key="callbacks" label="Callbacks on your leads" value={callbacks.length} hint={callbacks.length === 0 ? "None open" : dueCallbacks > 0 ? `${dueCallbacks} due now` : "None due yet"} />,
    <Stat key="result" label="Need a result" value={needResult} hint="Consultation held, no Won or Lost yet" href={withAs("/designer/leads?show=result", as)} />,
  ];

  return (
    <main className="flex flex-col gap-6">
      <ViewAsBanner view={view} />
      <Flash done={params.done} by={params.by} />
      <PageHeader title={`${greeting(now)}, ${firstName(designer.name)}`} eyebrow={istDay(now)}>
        <span className="text-xs text-ink-soft">All times IST</span>
      </PageHeader>

      <section aria-label="Today at a glance" className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles}
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <Card>
          <div id="waiting" className="scroll-mt-6" />
          <SectionTitle title="Waiting for you" hint="Posted to the designers and not accepted yet: yours, or unassigned in your consultation types. First to accept wins, here or on Telegram." />
          {waiting.length === 0 ? (
            <Empty>Nothing waiting. New handoffs show up here and on Telegram at the same time.</Empty>
          ) : (
            <ul className="stagger flex flex-col gap-3">
              {waiting.map((handoff) => (
                <li key={handoff.handoffId} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-line-strong sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={withAs(`/designer/leads/${handoff.enquiryId}`, as)} className="font-medium text-ink underline-offset-4 hover:underline">
                        {handoff.callerName ?? "Unknown caller"}
                      </Link>
                      {handoff.forMe ? <Badge tone="accent">Assigned to you</Badge> : <Badge>Open to you</Badge>}
                      {handoff.escalated && <Badge tone="danger">Escalated</Badge>}
                    </div>
                    <p className="text-sm text-ink-muted">
                      {[handoff.locality, handoff.consultType ? CONSULT_LABEL[handoff.consultType] : null, handoff.bookingAt ? istWhen(handoff.bookingAt) : "Not booked yet"].filter(Boolean).join(" · ")}
                    </p>
                    {(handoff.summary ?? handoff.scope) && <p className="text-sm text-ink">{handoff.summary ?? handoff.scope}</p>}
                    <p className="text-xs text-ink-soft">
                      Posted {relTime(handoff.postedAt, now)}
                      {handoff.phoneMasked ? <span className="font-mono"> · {handoff.phoneMasked}</span> : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Link href={withAs(`/designer/leads/${handoff.enquiryId}`, as)} className={buttonSecondary}>
                      Details
                    </Link>
                    <AcceptButton handoffId={handoff.handoffId} back="/designer" readOnly={readOnly} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="flex min-w-0 flex-col gap-6">
          <ConsultList title="Today" meetings={todays} leads={leadOf} as={as} empty="No consultations today." />
          <ConsultList title={`Tomorrow · ${istDay(new Date(now.getTime() + 86_400_000))}`} meetings={tomorrows} leads={leadOf} as={as} empty="Nothing booked for tomorrow yet." />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle title="Callbacks on your leads" hint="Open callback tasks the front desk logged for enquiries you own." />
          {callbacks.length === 0 ? (
            <Empty>No open callbacks.</Empty>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {callbacks.map((task) => (
                <li key={task.taskId} className="flex flex-wrap items-baseline justify-between gap-2 py-3 first:pt-0 last:pb-0">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    {task.enquiryId ? (
                      <Link href={withAs(`/designer/leads/${task.enquiryId}`, as)} className="font-medium text-ink underline-offset-4 hover:underline">
                        {task.callerName ?? "Unknown caller"}
                      </Link>
                    ) : (
                      <span className="font-medium text-ink">{task.callerName ?? "Unknown caller"}</span>
                    )}
                    {task.reason && <span className="text-sm text-ink-muted">{task.reason}</span>}
                  </span>
                  {task.dueAt && (
                    <Badge tone={task.dueAt.getTime() <= now.getTime() ? "warn" : "neutral"}>
                      {task.dueAt.getTime() <= now.getTime() ? "Was due" : "Due"} {istWhen(task.dueAt)}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <SectionTitle title="Recent activity" hint="On the enquiries you own." />
          {activity.length === 0 ? (
            <Empty>Nothing yet.</Empty>
          ) : (
            <ol className="flex flex-col gap-3">
              {activity.map((event) => (
                <li key={`${event.kind}-${event.enquiryId}-${event.at.getTime()}`} className="flex items-center gap-3 text-sm">
                  <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${ACTIVITY[event.kind].dot}`} />
                  <span className="min-w-0 flex-1 truncate text-ink">
                    {ACTIVITY[event.kind].text}:{" "}
                    <Link href={withAs(`/designer/leads/${event.enquiryId}`, as)} className="font-medium underline-offset-4 hover:underline">
                      {event.callerName ?? "Unknown caller"}
                    </Link>
                  </span>
                  <time dateTime={event.at.toISOString()} className="shrink-0 text-xs text-ink-soft tabular-nums">
                    {relTime(event.at, now)}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </main>
  );
}
