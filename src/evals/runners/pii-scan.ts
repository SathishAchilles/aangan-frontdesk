// Eval pii-scan: scans the production logs Vercel still holds for full Indian mobile numbers and the
// exact values of every secret. Vercel's runtime log retention on the current plan is short (about an
// hour), so the report records the window actually covered; a full 7-day scan needs a log drain.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { EvalRunner } from "../registry";
import { buildReport } from "../report";
import type { ItemResult } from "../types";

const FULL_MOBILE = /(?<![\d•])(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/;
const SECRET_ENV = [
  "TOOL_SECRET",
  "VAANI_WEBHOOK_TOKEN",
  "CRON_SECRET",
  "CALCOM_WEBHOOK_SECRET",
  "TELEGRAM_WEBHOOK_SECRET",
  "VAANI_API_KEY",
  "CALCOM_API_KEY",
  "GEMINI_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "HUBSPOT_PRIVATE_APP_TOKEN",
];

type LogRow = { id: string; timestamp: number; [field: string]: unknown };

const PLATFORM_FIELDS = new Set(["id", "timestamp", "traceId", "deploymentId", "projectId"]);

function readLogs(): LogRow[] {
  const file = process.env.PII_SCAN_FILE;
  const text = file
    ? readFileSync(file, "utf8")
    : execFileSync("vercel", ["logs", "--environment", "production", "--since", "7d", "--json", "--limit", "5000", "--expand", "--non-interactive"], {
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      });
  return text
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as LogRow);
}

export const piiScan: EvalRunner = async ({ budget }) => {
  const startedAt = new Date();
  const rows = readLogs();
  const secrets = SECRET_ENV.map((name) => [name, process.env[name] ?? ""] as const).filter(([, value]) => value.length >= 8);
  const items: ItemResult[] = [];
  let phoneHits = 0;
  let secretHits = 0;
  for (const row of rows) {
    // Every field Vercel recorded (query strings, headers, messages), minus its own ids and timestamps.
    const text = JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key]) => !PLATFORM_FIELDS.has(key))));
    const phone = FULL_MOBILE.test(text);
    const leaked = secrets.filter(([, value]) => text.includes(value)).map(([name]) => name);
    phoneHits += phone ? 1 : 0;
    secretHits += leaked.length;
    if (phone || leaked.length > 0) {
      // Never store the matched value itself in the report.
      items.push({ item_id: row.id, expected: "no personal data or secrets", actual: { full_phone: phone, secrets: leaked }, scores: { clean: false }, passed: false });
    }
  }
  const times = rows.map((row) => row.timestamp);
  const windowHours = times.length ? (Math.max(...times) - Math.min(...times)) / 3_600_000 : 0;
  return buildReport({
    evalName: "pii-scan",
    datasetVersion: `vercel-production-${new Date().toISOString().slice(0, 10)}`,
    startedAt,
    metrics: { log_lines: rows.length, window_hours: Math.round(windowHours * 100) / 100, secrets_checked: secrets.length, phone_hits: phoneHits, secret_hits: secretHits },
    thresholds: [
      { metric: "phone_hits", op: "==", value: 0, hard: true },
      { metric: "secret_hits", op: "==", value: 0, hard: true },
      { metric: "log_lines", op: ">=", value: 1 },
      // Shown as a failure until a log drain gives a full 7-day window.
      { metric: "window_hours", op: ">=", value: 168 },
    ],
    items,
    costInr: budget.spentInr,
  });
};
