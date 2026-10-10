import { describe, expect, it } from "vitest";
import { missingRequired, parseEnv } from "./env";

describe("parseEnv", () => {
  it("accepts a valid set and applies defaults", () => {
    const env = parseEnv({
      DATABASE_URL: "postgresql://user:pass@host:6543/postgres",
      FRONT_DESK_PHONE: "+918056203528",
    });
    expect(env.DB_SCHEMA).toBe("aangan");
    expect(env.GEMINI_MODEL).toBe("gemini-3.8-flash");
    expect(env.EVAL_BUDGET_INR).toBe(300);
    expect(env.APP_URL).toBe("https://aangan-frontdesk.vercel.app");
  });

  it("treats blank values as missing", () => {
    const env = parseEnv({ GEMINI_API_KEY: "" });
    expect(env.GEMINI_API_KEY).toBeUndefined();
  });

  it("rejects a malformed URL with the variable name in the message", () => {
    expect(() => parseEnv({ DATABASE_URL: "not a url" })).toThrow(/DATABASE_URL/);
  });

  it("rejects a phone number that is not E.164", () => {
    expect(() => parseEnv({ FRONT_DESK_PHONE: "08056203528" })).toThrow(/FRONT_DESK_PHONE: must be E\.164/);
  });

  it("rejects an unknown schema name", () => {
    expect(() => parseEnv({ DB_SCHEMA: "public" })).toThrow(/DB_SCHEMA/);
  });
});

describe("missingRequired", () => {
  it("lists only the required variables that are absent", () => {
    const env = parseEnv({ DATABASE_URL: "postgresql://u:p@h:6543/postgres" });
    expect(missingRequired(env, ["DATABASE_URL", "TOOL_SECRET", "CRON_SECRET"])).toEqual([
      "TOOL_SECRET",
      "CRON_SECRET",
    ]);
  });
});
