import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";

export const DATASET_DIR = join(process.cwd(), "evals", "datasets");

// Reads a JSONL dataset, validating every line; the error names the file and line.
export function loadJsonl<S extends z.ZodType>(file: string, schema: S): z.infer<S>[] {
  const text = readFileSync(join(DATASET_DIR, file), "utf8");
  return text
    .split("\n")
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line.length > 0)
    .map(({ line, number }) => {
      const parsed = schema.safeParse(JSON.parse(line));
      if (!parsed.success) {
        throw new Error(`${file}:${number}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`);
      }
      return parsed.data;
    });
}

// Content hash, so every eval report records exactly which data it ran on.
export function datasetVersion(...files: string[]): string {
  const hash = createHash("sha256");
  for (const file of files) hash.update(readFileSync(join(DATASET_DIR, file)));
  return hash.digest("hex").slice(0, 12);
}
