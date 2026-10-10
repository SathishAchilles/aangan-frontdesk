import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EvalReport, ItemResult, Threshold } from "./types";

export function commitSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}

export function failedThresholds(metrics: Record<string, number>, thresholds: Threshold[]): string[] {
  return thresholds
    .filter(({ metric, op, value }) => {
      const actual = metrics[metric];
      if (actual === undefined || Number.isNaN(actual)) return true;
      if (op === ">=") return actual < value;
      if (op === "<=") return actual > value;
      return actual !== value;
    })
    .map(({ metric, op, value, hard }) => `${hard ? "[hard] " : ""}${metric} ${op} ${value} (got ${metrics[metric]})`);
}

export function buildReport(input: {
  evalName: string;
  datasetVersion: string;
  promptVersion?: string | null;
  settingsVersion?: number | null;
  startedAt: Date;
  metrics: Record<string, number>;
  thresholds: Threshold[];
  items: ItemResult[];
  costInr: number;
}): EvalReport {
  const failed = failedThresholds(input.metrics, input.thresholds);
  return {
    eval_name: input.evalName,
    dataset_version: input.datasetVersion,
    commit_sha: commitSha(),
    prompt_version: input.promptVersion ?? null,
    settings_version: input.settingsVersion ?? null,
    started_at: input.startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    metrics: input.metrics,
    thresholds: input.thresholds,
    failed_thresholds: failed,
    passed: failed.length === 0,
    cost_inr: Math.round(input.costInr * 100) / 100,
    items: input.items,
  };
}

export type ReportSink = (report: EvalReport) => Promise<void>;

export function writeReportFile(report: EvalReport, dir = join(process.cwd(), "evals", "reports")): string {
  mkdirSync(dir, { recursive: true });
  const stamp = report.started_at.replace(/[:.]/g, "-");
  const path = join(dir, `${report.eval_name}-${stamp}.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

export function summarise(report: EvalReport): string {
  const lines = [
    `${report.passed ? "PASS" : "FAIL"} ${report.eval_name} (dataset ${report.dataset_version}, cost Rs ${report.cost_inr})`,
    ...Object.entries(report.metrics).map(([key, value]) => `  ${key}: ${Number.isInteger(value) ? value : value.toFixed(3)}`),
  ];
  if (report.failed_thresholds.length > 0) lines.push("  failed:", ...report.failed_thresholds.map((f) => `    ${f}`));
  const failing = report.items.filter((item) => !item.passed).slice(0, 20);
  if (failing.length > 0) lines.push("  failing items:", ...failing.map((item) => `    ${item.item_id}`));
  return lines.join("\n");
}
