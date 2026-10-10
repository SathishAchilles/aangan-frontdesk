import { describe, expect, it } from "vitest";
import { maskPhone, toE164 } from "./phone";

describe("toE164", () => {
  it.each([
    ["+91 80562 03528", "+918056203528"],
    ["8056203528", "+918056203528"],
    ["08056203528", "+918056203528"],
    ["918056203528", "+918056203528"],
    ["0091 80562-03528", "+918056203528"],
    ["+1 (415) 555-1234", "+14155551234"],
  ])("%s -> %s", (input, expected) => {
    expect(toE164(input)).toBe(expected);
  });

  it.each(["", "12345", "not a number", undefined, null])("rejects %s", (input) => {
    expect(toE164(input)).toBeUndefined();
  });
});

describe("maskPhone", () => {
  it("keeps the country code and last four digits", () => {
    expect(maskPhone("+918056203528")).toBe("+91 ••••• •3528");
  });
});
