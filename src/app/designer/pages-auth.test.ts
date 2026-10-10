import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Layouts do not re-render on client navigation, so every designer page checks access itself, and
// every server action checks that a designer (not an admin viewing as one) is acting.
function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? pages(join(dir, entry.name)) : entry.name === "page.tsx" ? [join(dir, entry.name)] : [],
  );
}

describe("designer pages", () => {
  const files = pages(__dirname);
  it("finds the pages", () => expect(files.length).toBeGreaterThanOrEqual(6));
  it.each(files)("%s checks access on the server", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).toMatch(/await (requireDesignerView\(|requireStaff\(\["admin"\]\))/);
  });
  it("the layout checks the role too", () => expect(readFileSync(join(__dirname, "layout.tsx"), "utf8")).toMatch(/await requireStaff\(DESIGNER_AREA_ROLES\)/));
});

describe("designer actions", () => {
  const source = readFileSync(join(__dirname, "actions.ts"), "utf8");
  const actions = [...source.matchAll(/export async function (\w+)\([^)]*\) \{\n([^]*?)\n\}/g)];
  it("finds the actions", () => expect(actions.map((match) => match[1]).sort()).toEqual(["acceptHandoffAction", "completeCallbackAction", "recordResultAction"]));
  it.each(actions.map((match) => [match[1], match[2]]))("%s takes the designer from the session first", (_name, body) => {
    expect(body.trimStart()).toMatch(/^const designer = await requireActingDesigner\(\);/);
  });
});
