import { describe, expect, it } from "vitest";
import { authorize, DASHBOARD_ROLES, DESIGNER_AREA_ROLES, redirectInsteadOfForbidden, safeNext } from "./authz";

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
  it("lets designers and admins into the designer area, nobody else", () => {
    expect(authorize({ role: "designer" }, DESIGNER_AREA_ROLES)).toBe("ok");
    expect(authorize({ role: "admin" }, DESIGNER_AREA_ROLES)).toBe("ok");
    expect(authorize({ role: "viewer" }, DESIGNER_AREA_ROLES)).toBe("forbidden");
    expect(authorize({ role: "front_desk" }, DESIGNER_AREA_ROLES)).toBe("forbidden");
  });
});

describe("redirectInsteadOfForbidden", () => {
  it("sends a designer on a dashboard page to their own area", () => expect(redirectInsteadOfForbidden({ role: "designer" }, DASHBOARD_ROLES)).toBe("/designer"));
  it("keeps the 403 for everyone else", () => {
    expect(redirectInsteadOfForbidden({ role: "viewer" }, ["admin"])).toBeNull();
    expect(redirectInsteadOfForbidden({ role: "front_desk" }, DASHBOARD_ROLES)).toBeNull();
    expect(redirectInsteadOfForbidden({ role: "designer" }, ["designer"])).toBeNull();
  });
});

describe("safeNext", () => {
  it("keeps pages in the staff areas", () => {
    expect(safeNext("/dashboard/settings")).toBe("/dashboard/settings");
    expect(safeNext("/designer")).toBe("/designer");
    expect(safeNext("/designer/leads?as=x")).toBe("/designer/leads?as=x");
  });
  it("falls back to the dashboard for anything else", () => {
    expect(safeNext(undefined)).toBe("/dashboard");
    expect(safeNext("https://evil.example/designer")).toBe("/dashboard");
    expect(safeNext("//evil.example")).toBe("/dashboard");
    expect(safeNext("/designers-elsewhere")).toBe("/dashboard");
    expect(safeNext("/login")).toBe("/dashboard");
  });
});
