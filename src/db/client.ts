import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as { db?: Db; sql?: postgres.Sql };

function connect(max: number): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // Supavisor's transaction pooler (:6543) does not support prepared statements.
  return postgres(url, { prepare: false, max, onnotice: () => {} });
}

// Drizzle replaces the date parsers on the client it wraps (timestamps come back as strings), so raw
// queries get their own client and keep postgres-js's Date parsing.
function getDb(): Db {
  globalForDb.db ??= drizzle(connect(5), { schema });
  return globalForDb.db;
}

function getSql(): postgres.Sql {
  globalForDb.sql ??= connect(3);
  return globalForDb.sql;
}

// Connect on first use, so `next build` can import this module without a database.
export const db = new Proxy({} as Db, {
  get: (_target, property) => Reflect.get(getDb(), property),
});

export function rawSql(): postgres.Sql {
  return getSql();
}
