// Seeds settings, localities, festival dates and placeholder staff. Safe to run repeatedly:
// setting values an admin has changed are kept; defaults, ranges and sources are refreshed.
// Usage: npm run seed  (DB_SCHEMA=aangan_test npm run seed for the test schema)
import postgres from "postgres";
import { SETTING_DEFINITIONS } from "../src/lib/settings/definitions";
import { FESTIVAL_DATES, LOCALITIES, STAFF } from "../src/lib/settings/seed-data";

const schema = process.env.DB_SCHEMA === "aangan_test" ? "aangan_test" : "aangan";
const url = process.env.DATABASE_MIGRATION_URL;
if (!url) throw new Error("DATABASE_MIGRATION_URL is not set");
const sql = postgres(url, { max: 1, onnotice: () => {} });
const t = (name: string) => sql(`${schema}.${name}`);

async function main() {
  await sql.begin(async (tx) => {
    for (const d of SETTING_DEFINITIONS) {
      await tx`
        insert into ${t("settings")} (key, value, default_value, type, min, max, source_note)
        values (${d.key}, ${tx.json(d.default as never)}, ${tx.json(d.default as never)}, ${d.type},
                ${d.min ?? null}, ${d.max ?? null}, ${d.source})
        on conflict (key) do update set
          default_value = excluded.default_value, type = excluded.type,
          min = excluded.min, max = excluded.max, source_note = excluded.source_note`;
    }

    const [{ count: versions }] = await tx<{ count: number }[]>`select count(*)::int as count from ${t("settings_versions")}`;
    if (versions === 0) {
      const rows = await tx<{ key: string; value: unknown }[]>`select key, value from ${t("settings")} order by key`;
      const snapshot = Object.fromEntries(rows.map((row) => [row.key, row.value]));
      await tx`insert into ${t("settings_versions")} (snapshot) values (${tx.json(snapshot as never)})`;
    }

    for (const locality of LOCALITIES) {
      await tx`
        insert into ${t("localities")} (name, aliases, status, note)
        values (${locality.name}, ${locality.aliases}, ${locality.status}, ${locality.note ?? null})
        on conflict (name) do update set aliases = excluded.aliases, status = excluded.status, note = excluded.note`;
    }

    for (const festival of FESTIVAL_DATES) {
      await tx`
        insert into ${t("festival_dates")} (name, year, date) values (${festival.name}, ${festival.year}, ${festival.date})
        on conflict (name, year) do update set date = excluded.date`;
    }

    for (const person of STAFF) {
      await tx`
        insert into ${t("staff")} (name, role, consult_types)
        select ${person.name}, ${person.role}, ${person.consultTypes}
        where not exists (select 1 from ${t("staff")} where name = ${person.name})`;
    }
  });

  const counts = await sql<{ name: string; count: number }[]>`
    select 'settings' as name, count(*)::int as count from ${t("settings")}
    union all select 'settings_versions', count(*)::int from ${t("settings_versions")}
    union all select 'localities', count(*)::int from ${t("localities")}
    union all select 'festival_dates', count(*)::int from ${t("festival_dates")}
    union all select 'staff', count(*)::int from ${t("staff")}`;
  console.log(`${schema}: ${counts.map((row) => `${row.name}=${row.count}`).join(" ")}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
