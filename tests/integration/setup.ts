// Integration tests always run against the aangan_test schema, never real data.
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
process.env.DB_SCHEMA = "aangan_test";

if (!process.env.DATABASE_MIGRATION_URL) {
  throw new Error("Integration tests need DATABASE_MIGRATION_URL (see .env.example).");
}
