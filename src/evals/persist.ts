// Stores an eval report in <schema>.eval_runs and eval_items so the Quality page can show trends.
import postgres from "postgres";
import type { EvalReport } from "./types";

export async function persistReport(report: EvalReport, url: string, schema: "aangan" | "aangan_test"): Promise<string> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return await sql.begin(async (tx) => {
      const [run] = await tx<{ id: string }[]>`
        insert into ${tx(`${schema}.eval_runs`)}
          (eval_name, dataset_version, commit_sha, prompt_version, settings_version, started_at, finished_at,
           metrics, thresholds, failed_thresholds, passed, cost_inr)
        values (${report.eval_name}, ${report.dataset_version}, ${report.commit_sha}, ${report.prompt_version},
                ${report.settings_version}, ${report.started_at}, ${report.finished_at},
                ${tx.json(report.metrics)}, ${tx.json(report.thresholds as never)}, ${report.failed_thresholds},
                ${report.passed}, ${report.cost_inr})
        returning id`;
      for (const item of report.items) {
        await tx`
          insert into ${tx(`${schema}.eval_items`)} (run_id, item_id, expected, actual, scores, passed, transcript_ref)
          values (${run.id}, ${item.item_id}, ${tx.json((item.expected ?? null) as never)}, ${tx.json((item.actual ?? null) as never)},
                  ${tx.json(item.scores)}, ${item.passed}, ${item.transcript_ref ?? null})`;
      }
      return run.id;
    });
  } finally {
    await sql.end();
  }
}
