import { describe, expect, it } from "vitest";
import { dropBlankArgs } from "./args";

describe("dropBlankArgs", () => {
  it("removes the blanks Vaani fills unused parameters with", () => {
    expect(
      dropBlankArgs({ enquiry_id: "", phone: "+919000000001", rooms: [], sqft: 0, full_home: false, wants_human: false, budget_text: null, locality: "  ", scope_text: "whole 3BHK" }),
    ).toEqual({ phone: "+919000000001", scope_text: "whole 3BHK" });
  });
  it("keeps real values and true flags", () => {
    expect(dropBlankArgs({ sqft: 1400, rooms: ["kitchen"], wants_human: true })).toEqual({ sqft: 1400, rooms: ["kitchen"], wants_human: true });
  });
  it("leaves non-objects alone", () => expect(dropBlankArgs("x")).toBe("x"));
});
