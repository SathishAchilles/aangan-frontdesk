// Who may see a dashboard page. Kept free of I/O so it can be tested on its own.
export const DASHBOARD_ROLES = ["admin", "viewer"] as const;

export type StaffRole = "admin" | "viewer" | "designer" | "front_desk";
export type Access = "login" | "forbidden" | "ok";

// No staff row (not logged in, or not studio staff) -> log in; wrong role -> 403.
export function authorize(me: { role: StaffRole } | null, roles: readonly StaffRole[]): Access {
  if (!me) return "login";
  return roles.includes(me.role) ? "ok" : "forbidden";
}
