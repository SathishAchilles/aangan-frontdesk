import { describe, expect, it } from "vitest";
import { toAuthPassword } from "./password";

const SUFFIX = "s".repeat(32);

describe("toAuthPassword", () => {
  it("accepts a 4-character password and pads it past Supabase's 6-character floor", () => {
    const result = toAuthPassword("1234", SUFFIX);
    expect(result).toEqual({ ok: true, authPassword: `1234${SUFFIX}` });
  });
  it("rejects passwords under 4 characters", () => {
    expect(toAuthPassword("123", SUFFIX)).toEqual({ ok: false, error: "Password must be at least 4 characters" });
  });
  it("refuses to work without a long enough suffix", () => {
    expect(toAuthPassword("1234", undefined).ok).toBe(false);
    expect(toAuthPassword("1234", "short").ok).toBe(false);
  });
});
