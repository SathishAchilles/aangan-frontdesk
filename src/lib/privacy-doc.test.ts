import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every column that can hold a caller's or staff member's personal data must be listed in docs/privacy.md.
const PERSONAL_DATA_COLUMNS = [
  "callers.phone_e164",
  "callers.name",
  "enquiries.facts",
  "enquiries.criteria",
  "calls.transcript",
  "calls.summary",
  "calls.recording_url",
  "handoffs.note",
  "tasks.payload",
  "bookings",
  "crm_links",
  "inbox.payload",
  "staff.name",
  "staff.email",
  "staff.telegram_user_id",
];

describe("docs/privacy.md", () => {
  const doc = readFileSync(join(__dirname, "../../docs/privacy.md"), "utf8");
  it.each(PERSONAL_DATA_COLUMNS)("lists %s", (column) => {
    expect(doc).toContain(`\`${column}\``);
  });
  it("states the disclosure line and the storage region", () => {
    expect(doc).toContain("this call is recorded");
    expect(doc).toMatch(/Singapore/);
  });
});
