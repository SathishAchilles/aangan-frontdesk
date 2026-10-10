// Sets one setting from the command line, with an audit entry and a new settings version.
// Usage: npm run setting:set -- <key> '<json value>' "<reason>"
import postgres from "postgres";
import { SETTING_DEFINITIONS } from "../src/lib/settings/definitions";

const [key, rawValue, reason] = process.argv.slice(2);
if (!key || rawValue === undefined || !reason) {
  console.error("Usage: npm run setting:set -- <key> '<json value>' \"<reason>\"");
  process.exit(2);
}
if (!SETTING_DEFINITIONS.some((definition) => definition.key === key)) {
  console.error(`Unknown setting ${key}`);
  process.exit(2);
}
const value: unknown = JSON.parse(rawValue);
const schema = process.env.DB_SCHEMA === "aangan_test" ? "aangan_test" : "aangan";
const url = process.env.DATABASE_MIGRATION_URL;
if (!url) throw new Error("DATABASE_MIGRATION_URL is not set");
const sql = postgres(url, { max: 1, onnotice: () => {} });
const t = (name: string) => sql(`${schema}.${name}`);

async function main() {
  await sql.begin(async (tx) => {
    const [current] = await tx<{ value: unknown }[]>`select value from ${t("settings")} where key = ${key} for update`;
    if (!current) throw new Error(`Setting ${key} is not seeded; run npm run seed first`);
    await tx`update ${t("settings")} set value = ${tx.json(value as never)}, updated_at = now() where key = ${key}`;
    await tx`insert into ${t("settings_audit")} (key, old_value, new_value, reason)
             values (${key}, ${tx.json(current.value as never)}, ${tx.json(value as never)}, ${reason})`;
    const rows = await tx<{ key: string; value: unknown }[]>`select key, value from ${t("settings")} order by key`;
    const snapshot = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    const [version] = await tx<{ id: number }[]>`insert into ${t("settings_versions")} (snapshot) values (${tx.json(snapshot as never)}) returning id`;
    console.log(`${schema}.${key} = ${JSON.stringify(value)} (settings version ${version.id})`);
  });
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
