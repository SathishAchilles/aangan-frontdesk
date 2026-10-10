import { describe, expect, it } from "vitest";
import { authorize, DASHBOARD_ROLES } from "./authz";

describe("authorize", () => {
  it("sends anonymous users and non-staff to login", () => expect(authorize(null, DASHBOARD_ROLES)).toBe("login"));
  it("lets admins and viewers into the dashboard", () => {
    expect(authorize({ role: "admin" }, DASHBOARD_ROLES)).toBe("ok");
    expect(authorize({ role: "viewer" }, DASHBOARD_ROLES)).toBe("ok");
  });
  it("forbids viewers on admin-only pages", () => expect(authorize({ role: "viewer" }, ["admin"])).toBe("forbidden"));
  it("forbids designers and front desk on the dashboard", () => {
    expect(authorize({ role: "designer" }, DASHBOARD_ROLES)).toBe("forbidden");
    expect(authorize({ role: "front_desk" }, DASHBOARD_ROLES)).toBe("forbidden");
  });
});
