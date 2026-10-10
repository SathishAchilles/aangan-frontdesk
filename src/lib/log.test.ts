import { describe, expect, it } from "vitest";
import { redact } from "./log";

describe("redact", () => {
  it.each([
    ["caller +918056203528 failed", "+918056203528"],
    ["caller +91 80562 03528 failed", "80562 03528"],
    ["call 8056203528 back", "8056203528"],
  ])("masks the phone number in %s", (text, secret) => {
    const out = redact(text);
    expect(out).not.toContain(secret);
    expect(out).toContain("3528");
  });

  it("removes tokens from URLs, bearer headers and known key formats", () => {
    const out = redact(
      "POST /api/webhooks/vaani?token=abc123def456&x=1 Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload key vaani_96abcdefghijkl cal_live_abcdefghijklmnop",
    );
    expect(out).not.toMatch(/abc123def456|eyJhbGci|vaani_96|cal_live_abc/);
    expect(out).toContain("token=[redacted]");
  });

  it("removes long hex secrets", () => {
    expect(redact(`secret ${"a1".repeat(32)}`)).toBe("secret [redacted-hex]");
  });

  it("leaves ordinary text alone", () => {
    expect(redact("evaluate_enquiry took 140 ms for 1,400 sq ft")).toBe("evaluate_enquiry took 140 ms for 1,400 sq ft");
  });
});
