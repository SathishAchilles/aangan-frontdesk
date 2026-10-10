import Link from "next/link";
import { notFound } from "next/navigation";
import { rawSql } from "@/db/client";
import { SCHEMA_NAME } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { definitionFor } from "@/lib/settings/validate";
import { Card, istTime, PageHeader, Table } from "../../ui";

export const dynamic = "force-dynamic";

export default async function SettingHistory({ params }: { params: Promise<{ key: string }> }) {
  await requireStaff(["admin"]);
  const { key } = await params;
  if (!definitionFor(key)) notFound();
  const sql = rawSql();
  const rows = await sql<{ at: Date; old_value: unknown; new_value: unknown; reason: string; actor: string | null }[]>`
    select a.at, a.old_value, a.new_value, a.reason, st.name as actor
    from ${sql(`${SCHEMA_NAME}.settings_audit`)} a left join ${sql(`${SCHEMA_NAME}.staff`)} st on st.id = a.actor_id
    where a.key = ${key} order by a.at desc limit 100`;
  return (
    <main className="flex flex-col gap-6">
      <Link href={`/dashboard/settings#${key}`} className="w-fit rounded-full text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline">
        ← Settings
      </Link>
      <PageHeader title={key} eyebrow="Setting history" mono />
      <Card title="History">
        <Table
          head={["When (IST)", "By", "From", "To", "Reason"]}
          rows={rows.map((row) => [istTime(row.at), row.actor ?? "script", JSON.stringify(row.old_value), JSON.stringify(row.new_value), row.reason])}
          empty="Never changed from its seeded value."
        />
      </Card>
    </main>
  );
}
