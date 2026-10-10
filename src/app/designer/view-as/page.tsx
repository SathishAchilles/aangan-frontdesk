import Link from "next/link";
import { rawSql } from "@/db/client";
import { SCHEMA_NAME } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { activeDesigners } from "@/lib/designer/queries";
import { Card, PageHeader } from "../../dashboard/ui";
import { CONSULT_LABEL, Empty } from "../ui";

export const dynamic = "force-dynamic";

// Admins pick whose designer area to look at. Designers never see this page (they are sent to
// their own area); viewers and front desk get a 403.
export default async function ViewAs() {
  await requireStaff(["admin"]);
  const designers = await activeDesigners(rawSql(), SCHEMA_NAME);
  return (
    <main className="flex flex-col gap-6">
      <PageHeader title="View as a designer" eyebrow="See exactly what a designer sees. Read-only: Accept and Won/Lost stay with the designer." />
      <Card>
        {designers.length === 0 ? (
          <Empty>No active designers on the staff list.</Empty>
        ) : (
          <ul className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {designers.map((designer) => (
              <li key={designer.id}>
                <Link href={`/designer?as=${designer.id}`} className="lift group flex h-full flex-col gap-2 rounded-2xl border border-line bg-surface p-4">
                  <span className="flex items-center gap-3">
                    <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-medium text-accent-soft-ink">
                      {designer.name.trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 truncate font-medium text-ink">{designer.name}</span>
                  </span>
                  <span className="text-xs text-ink-soft">{designer.consultTypes.length > 0 ? designer.consultTypes.map((type) => CONSULT_LABEL[type] ?? type).join(" · ") : "No consultation types set"}</span>
                  <span className="mt-auto pt-1 text-sm font-medium text-accent">Open their area →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
