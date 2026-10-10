// Who may see a dashboard page. Kept free of I/O so it can be tested on its own.
export const DASHBOARD_ROLES = ["admin", "viewer"] as const;
// The designer area: designers see their own work; admins may look at it read-only.
export const DESIGNER_AREA_ROLES = ["designer", "admin"] as const;

export type StaffRole = "admin" | "viewer" | "designer" | "front_desk";
export type Access = "login" | "forbidden" | "ok";

// No staff row (not logged in, or not studio staff) -> log in; wrong role -> 403.
export function authorize(me: { role: StaffRole } | null, roles: readonly StaffRole[]): Access {
  if (!me) return "login";
  return roles.includes(me.role) ? "ok" : "forbidden";
}

// A designer who opens a page their role cannot see goes to their own area instead of a 403.
export function redirectInsteadOfForbidden(me: { role: StaffRole }, roles: readonly StaffRole[]): string | null {
  return me.role === "designer" && !roles.includes("designer") ? "/designer" : null;
}

// Where to go after signing in: a page in one of the staff areas, never another site.
export function safeNext(next: string | null | undefined): string {
  return next && /^\/(dashboard|designer)(?:[/?#]|$)/.test(next) ? next : "/dashboard";
}
