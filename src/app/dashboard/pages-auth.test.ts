import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Layouts do not re-render on client navigation, so every dashboard page checks the role itself.
function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? pages(join(dir, entry.name)) : entry.name === "page.tsx" ? [join(dir, entry.name)] : [],
  );
}

describe("dashboard pages", () => {
  const files = pages(__dirname);
  it("finds the pages", () => expect(files.length).toBeGreaterThanOrEqual(8));
  it.each(files)("%s calls requireStaff", (file) => {
    expect(readFileSync(file, "utf8")).toMatch(/await requireStaff\(/);
  });
});
