// Clears recording links and transcripts once they pass their retention period.
import type postgres from "postgres";

export async function applyRetention(sql: postgres.Sql, schema: string, days: { recordings: number; transcripts: number }) {
  const calls = sql(`${schema}.calls`);
  const recordings = await sql`
    update ${calls} set recording_url = null
    where recording_url is not null and created_at < now() - make_interval(days => ${days.recordings}) returning id`;
  const transcripts = await sql`
    update ${calls} set transcript = null, summary = null
    where (transcript is not null or summary is not null) and created_at < now() - make_interval(days => ${days.transcripts}) returning id`;
  return { recordings_cleared: recordings.length, transcripts_cleared: transcripts.length };
}
