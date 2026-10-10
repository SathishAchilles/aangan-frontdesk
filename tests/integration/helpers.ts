import { execFileSync } from "node:child_process";
import postgres from "postgres";

export const TEST_SCHEMA = "aangan_test";

export function testSql(): postgres.Sql {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) throw new Error("DATABASE_MIGRATION_URL is not set");
  return postgres(url, { max: 2, onnotice: () => {} });
}

function runScript(script: string, args: string[] = []): string {
  return execFileSync("npx", ["tsx", script, ...args], {
    env: { ...process.env, DB_SCHEMA: TEST_SCHEMA },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// Drops and rebuilds every table in aangan_test from drizzle/*.sql.
export function rebuildTestSchema(): string {
  return runScript("scripts/migrate.ts", [TEST_SCHEMA]);
}

export function seedTestSchema(): string {
  return runScript("scripts/seed.ts");
}
