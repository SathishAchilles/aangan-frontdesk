// Sets one setting from the command line, with an audit entry and a new settings version.
// Usage: npm run setting:set -- <key> '<json value>' "<reason>"
import postgres from "postgres";
import { SETTING_DEFINITIONS } from "../src/lib/settings/definitions";
import { saveSetting } from "../src/lib/settings/write";

const [key, rawValue, reason] = process.argv.slice(2);
if (!key || rawValue === undefined || !reason) {
  console.error("Usage: npm run setting:set -- <key> '<json value>' \"<reason>\"");
  process.exit(2);
}
if (!SETTING_DEFINITIONS.some((definition) => definition.key === key)) {
  console.error(`Unknown setting ${key}`);
  process.exit(2);
}
const schema = process.env.DB_SCHEMA === "aangan_test" ? "aangan_test" : "aangan";
const url = process.env.DATABASE_MIGRATION_URL;
if (!url) throw new Error("DATABASE_MIGRATION_URL is not set");
const sql = postgres(url, { max: 1, onnotice: () => {} });

async function main() {
  const result = await saveSetting(sql, schema, { key, raw: rawValue, reason, actorId: null });
  if (!result.ok) throw new Error(result.error);
  console.log(`${schema}.${key} = ${rawValue} (settings version ${result.version})`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
