import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Budget } from "../budget";
import { piiScan } from "./pii-scan";

function logFile(lines: object[]) {
  const file = join(mkdtempSync(join(tmpdir(), "pii-")), "logs.jsonl");
  writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  return file;
}

afterEach(() => vi.unstubAllEnvs());

describe("pii-scan", () => {
  it("fails on a full phone number and on a leaked secret, without storing either", async () => {
    vi.stubEnv("TOOL_SECRET", "planted-tool-secret-123");
    vi.stubEnv(
      "PII_SCAN_FILE",
      logFile([
        { id: "a", timestamp: 1, requestPath: "/api/vaani/tools/lookup-caller", logs: [{ message: "caller +918056203528 not found" }] },
        { id: "b", timestamp: 2, requestPath: "/api/webhooks/vaani?token=planted-tool-secret-123", logs: [] },
        { id: "c", timestamp: 3, requestPath: "/api/health", logs: [{ message: "caller •••••03528 ok" }] },
      ]),
    );
    const report = await piiScan({ budget: new Budget(0), args: {} } as never);
    expect(report.passed).toBe(false);
    expect(report.metrics).toMatchObject({ phone_hits: 1, secret_hits: 1, log_lines: 3 });
    expect(JSON.stringify(report.items)).not.toMatch(/8056203528|planted-tool-secret/);
  });

  it("passes clean, masked logs", async () => {
    vi.stubEnv("PII_SCAN_FILE", logFile([{ id: "c", timestamp: 3, requestPath: "/api/health", logs: [{ message: "caller •••••03528 ok" }] }]));
    expect((await piiScan({ budget: new Budget(0), args: {} } as never)).passed).toBe(true);
  });
});
