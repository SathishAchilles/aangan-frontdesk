import Link from "next/link";
import { rawSql } from "@/db/client";
import { SCHEMA_NAME } from "@/db/schema";
import { requireDesignerView } from "@/lib/designer/access";
import { withAs } from "@/lib/designer/links";
import { myLeads } from "@/lib/designer/queries";
import { Badge, Card, OUTCOME_LABEL, OUTCOME_TONE, PageHeader, renderedAt } from "../../dashboard/ui";
import { CONSULT_LABEL, Empty, Flash, istDay, istWhen, PillLinks, ResultBadge, ViewAsBanner } from "../ui";

export const dynamic = "force-dynamic";

type Params = { as?: string; show?: string; done?: string; by?: string };

export default async function MyLeads({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const view = await requireDesignerView(params.as);
  const { designer, as } = view;
  const now = renderedAt();
  const all = await myLeads(rawSql(), SCHEMA_NAME, designer.id, now);
  const show = params.show === "result" || params.show === "upcoming" ? params.show : "all";
  const upcoming = (lead: (typeof all)[number]) => lead.booking !== null && lead.booking.status !== "cancelled" && lead.booking.startAt.getTime() > now.getTime();
  const leads = show === "result" ? all.filter((lead) => lead.needsResult) : show === "upcoming" ? all.filter(upcoming) : all;

  return (
    <main className="flex flex-col gap-6">
      <ViewAsBanner view={view} />
      <Flash done={params.done} by={params.by} />
      <PageHeader title="My leads" eyebrow={`Enquiries assigned to ${view.readOnly ? designer.name : "you"} or accepted by ${view.readOnly ? "them" : "you"}`}>
        <PillLinks
          as={as}
          active={show}
          items={[
            ["/designer/leads", `All · ${all.length}`, "all"],
            ["/designer/leads?show=upcoming", `Upcoming · ${all.filter(upcoming).length}`, "upcoming"],
            ["/designer/leads?show=result", `Need a result · ${all.filter((lead) => lead.needsResult).length}`, "result"],
          ]}
        />
      </PageHeader>
      <Card>
        {leads.length === 0 ? (
          <Empty>{show === "result" ? "Every consultation held has a result. Nice." : show === "upcoming" ? "No upcoming consultations." : "No enquiries yet."}</Empty>
        ) : (
          <ul className="stagger -my-2 flex flex-col divide-y divide-line">
            {leads.map((lead) => (
              <li key={lead.enquiryId} className="py-2">
                <Link
                  href={withAs(`/designer/leads/${lead.enquiryId}`, as)}
                  className="group -mx-3 grid gap-x-6 gap-y-1.5 rounded-2xl px-3 py-2.5 transition-colors hover:bg-surface-2 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-center"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-medium text-ink group-hover:underline group-hover:underline-offset-4">{lead.callerName ?? "Unknown caller"}</span>
                    <span className="font-mono text-xs text-ink-soft">{lead.phoneMasked ?? "No caller ID"}</span>
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5 text-sm">
                    <span className="truncate text-ink-muted">{lead.locality ?? "Locality not given"}</span>
                    {lead.scope && <span className="truncate text-xs text-ink-soft">{lead.scope}</span>}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5 text-sm">
                    {lead.booking ? (
                      <>
                        <span className={`truncate tabular-nums ${lead.booking.status === "cancelled" ? "text-ink-soft line-through" : "text-ink"}`}>{istWhen(lead.booking.startAt)}</span>
                        <span className="truncate text-xs text-ink-soft">
                          {CONSULT_LABEL[lead.booking.consultType] ?? "Consultation"}
                          {lead.booking.status !== "booked" ? ` · ${lead.booking.status}` : ""}
                        </span>
                      </>
                    ) : (
                      <span className="text-ink-soft">Not booked · enquiry {istDay(lead.createdAt)}</span>
                    )}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 md:justify-end">
                    <Badge tone={OUTCOME_TONE[lead.outcome] ?? "neutral"}>{OUTCOME_LABEL[lead.outcome] ?? lead.outcome}</Badge>
                    <ResultBadge result={lead.result} />
                    {lead.needsResult && <Badge tone="warn">Needs result</Badge>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-xs text-ink-soft">Phone numbers are masked in lists. The full number is on each lead&apos;s own page, for the designer who owns it.</p>
    </main>
  );
}
