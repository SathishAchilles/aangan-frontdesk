import { rawSql } from "@/db/client";
import { SCHEMA_NAME } from "@/db/schema";
import { parseRange } from "@/lib/dashboard/metrics";
import { addDays } from "@/lib/dashboard/schedule";
import { requireDesignerView } from "@/lib/designer/access";
import { designerPerformance } from "@/lib/designer/queries";
import { loadSettings } from "@/lib/settings/store";
import { Card, PageHeader, RangePicker, renderedAt } from "../../dashboard/ui";
import { KpiCard, ViewAsBanner } from "../ui";

export const dynamic = "force-dynamic";

const shortDate = (date: string) => new Date(`${date}T12:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

export default async function Performance({ searchParams }: { searchParams: Promise<{ as?: string; from?: string; to?: string }> }) {
  const params = await searchParams;
  const view = await requireDesignerView(params.as);
  const { designer, as } = view;
  const range = parseRange(params);
  const now = renderedAt();
  const { values } = await loadSettings();
  const limit = Number(values.accept_escalate_min ?? 30);
  const result = await designerPerformance(rawSql(), SCHEMA_NAME, designer.id, range, now, limit);
  const period = `${shortDate(range.from)} – ${shortDate(addDays(range.to, -1))}`;
  const you = view.readOnly ? designer.name : "you";
  const days = Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000);

  return (
    <main className="flex flex-col gap-6">
      <ViewAsBanner view={view} />
      <PageHeader title="Performance" eyebrow={`How ${you} compare${view.readOnly ? "s" : ""} with the studio, ${period}`}>
        <RangePicker range={range} path="/designer/performance" keep={{ as: as ?? undefined }} />
      </PageHeader>
      <section aria-label="Key numbers" className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {result.kpis.map((kpi) => (
          <KpiCard key={kpi.key} kpi={kpi} period={`${days}d`} studioHint={kpi.unit === "count" ? "average per designer" : "overall"} />
        ))}
      </section>
      <Card title="How these are counted">
        <ul className="grid gap-3 text-sm text-ink-muted md:grid-cols-2">
          <li>
            <span className="font-medium text-ink">Accept time</span> runs from the handoff being posted to the designers to the Accept press, on Telegram or here. Lower is better.
          </li>
          <li>
            <span className="font-medium text-ink">Within {limit} min</span> is the share of handoffs meant for {you} (assigned, or taken) that were accepted inside the escalation limit set by the studio.
          </li>
          <li>
            <span className="font-medium text-ink">Consultations held</span> are bookings with {you} that have already started; the studio figure is the average per active designer ({result.designers}).
          </li>
          <li>
            <span className="font-medium text-ink">Won and win rate</span> cover enquiries from this period with a recorded result, the same cohort as the admin Designers page.
          </li>
        </ul>
        <p className="mt-4 text-xs text-ink-soft">
          Sparklines show {result.bucketDays === 1 ? "each day" : "each week"}: the solid line is {you}, the dashed line the studio. Win rate is drawn as a running rate.
        </p>
      </Card>
    </main>
  );
}
