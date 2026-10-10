import { NextResponse } from "next/server";
import { rawSql } from "@/db/client";
import { SCHEMA_NAME } from "@/db/schema";

export const dynamic = "force-dynamic";

// Liveness plus a database round trip. Returns timings only, never data.
export async function GET() {
  const started = performance.now();
  try {
    const sql = rawSql();
    const [row] = await sql<{ tables: number }[]>`
      select count(*)::int as tables from information_schema.tables where table_schema = ${SCHEMA_NAME}`;
    const dbMs = Math.round(performance.now() - started);
    return NextResponse.json({ ok: true, schema: SCHEMA_NAME, tables: row.tables, db_ms: dbMs });
  } catch {
    return NextResponse.json({ ok: false, error: "database unavailable" }, { status: 503 });
  }
}
