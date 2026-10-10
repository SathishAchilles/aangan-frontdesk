import { rawSql } from "@/db/client";
import { SCHEMA_NAME } from "@/db/schema";
import { schedule } from "@/lib/dashboard/schedule";
import { requireDesignerView } from "@/lib/designer/access";
import { withAs } from "@/lib/designer/links";
import { bookingLeads } from "@/lib/designer/queries";
import { PageHeader, renderedAt } from "../../dashboard/ui";
import { ConsultationCalendar, parseCalendar, type CalendarParams } from "../../dashboard/designers/calendar";
import { ViewAsBanner } from "../ui";

export const dynamic = "force-dynamic";

export default async function MyCalendar({ searchParams }: { searchParams: Promise<CalendarParams & { as?: string }> }) {
  const params = await searchParams;
  const view = await requireDesignerView(params.as);
  const { designer, as } = view;
  const now = renderedAt();
  // Always this designer's own bookings: the filter comes from the session, not from the URL.
  const own: CalendarParams = { view: params.view, week: params.week, date: params.date };
  const cal = parseCalendar({ ...own, designer: designer.id }, now);
  const sql = rawSql();
  const meetings = await schedule(sql, SCHEMA_NAME, cal.start, cal.end, designer.id);
  const leads = await bookingLeads(sql, SCHEMA_NAME, meetings.map((meeting) => meeting.id));
  return (
    <main className="flex flex-col gap-6">
      <ViewAsBanner view={view} />
      <PageHeader title="Calendar" eyebrow={`Consultations booked with ${view.readOnly ? designer.name : "you"}`} />
      <ConsultationCalendar
        params={own}
        cal={cal}
        meetings={meetings}
        designers={[{ id: designer.id, name: designer.name }]}
        now={now}
        links={{
          base: "/designer/calendar",
          keep: { as: as ?? undefined },
          meeting: (meeting) => (leads.has(meeting.id) ? withAs(`/designer/leads/${leads.get(meeting.id)}`, as) : null),
          openLabel: "Open the lead →",
          designerFilter: false,
        }}
      />
    </main>
  );
}
