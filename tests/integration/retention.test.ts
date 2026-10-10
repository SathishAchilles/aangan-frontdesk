import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyRetention } from "../../src/lib/retention";
import { rebuildTestSchema, TEST_SCHEMA, testSql } from "./helpers";

const sql = testSql();
const t = (name: string) => sql(`${TEST_SCHEMA}.${name}`);

beforeAll(() => {
  rebuildTestSchema();
}, 180_000);

afterAll(async () => {
  await sql.end();
});

describe("retention", () => {
  it("clears old recordings and transcripts and keeps recent ones", async () => {
    await sql`insert into ${t("calls")} (vaani_call_id, transcript, summary, recording_url, created_at) values
      ('old-400', 't', 's', 'https://r/1', now() - interval '400 days'),
      ('old-100', 't', 's', 'https://r/2', now() - interval '100 days'),
      ('new-10', 't', 's', 'https://r/3', now() - interval '10 days')`;
    expect(await applyRetention(sql, TEST_SCHEMA, { recordings: 90, transcripts: 365 })).toEqual({ recordings_cleared: 2, transcripts_cleared: 1 });
    const rows = await sql<{ vaani_call_id: string; transcript: string | null; recording_url: string | null }[]>`select vaani_call_id, transcript, recording_url from ${t("calls")} order by vaani_call_id`;
    expect(rows).toEqual([
      { vaani_call_id: "new-10", transcript: "t", recording_url: "https://r/3" },
      { vaani_call_id: "old-100", transcript: "t", recording_url: null },
      { vaani_call_id: "old-400", transcript: null, recording_url: null },
    ]);
    expect(await applyRetention(sql, TEST_SCHEMA, { recordings: 90, transcripts: 365 })).toEqual({ recordings_cleared: 0, transcripts_cleared: 0 });
  });
});
