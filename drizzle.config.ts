import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  schemaFilter: ["aangan"],
  // Apply with `npm run db:migrate` (scripts/migrate.ts), not `drizzle-kit migrate`: aangan_app
  // cannot run the CREATE SCHEMA that drizzle-kit's migrator issues. drizzle-kit is used to generate.
  dbCredentials: {
    // Migrations use the session pooler (:5432); the app uses the transaction pooler.
    url: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
