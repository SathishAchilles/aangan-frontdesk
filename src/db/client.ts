import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as { db?: Db; sql?: postgres.Sql };

function getSql(): postgres.Sql {
  if (globalForDb.sql) return globalForDb.sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // Supavisor's transaction pooler (:6543) does not support prepared statements.
  globalForDb.sql = postgres(url, { prepare: false, max: 5, onnotice: () => {} });
  return globalForDb.sql;
}

function getDb(): Db {
  globalForDb.db ??= drizzle(getSql(), { schema });
  return globalForDb.db;
}

// Connect on first use, so `next build` can import this module without a database.
export const db = new Proxy({} as Db, {
  get: (_target, property) => Reflect.get(getDb(), property),
});

export function rawSql(): postgres.Sql {
  return getSql();
}
