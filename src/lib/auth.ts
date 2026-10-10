import "server-only";
import { and, eq } from "drizzle-orm";
import { forbidden, redirect } from "next/navigation";
import { db } from "@/db/client";
import { staff } from "@/db/schema";
import { authorize, DASHBOARD_ROLES, redirectInsteadOfForbidden, type StaffRole } from "./authz";
import { supabaseServer } from "./supabase/server";

export type CurrentStaff = { id: string; name: string; role: StaffRole; email: string | null };

// The logged-in Supabase user mapped to an active staff row; anyone else is not let in.
export async function currentStaff(): Promise<CurrentStaff | null> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const [row] = await db
    .select({ id: staff.id, name: staff.name, role: staff.role, email: staff.email })
    .from(staff)
    .where(and(eq(staff.authUserId, user.id), eq(staff.active, true)))
    .limit(1);
  return row ?? null;
}

export async function requireStaff(roles: readonly StaffRole[] = DASHBOARD_ROLES): Promise<CurrentStaff> {
  const me = await currentStaff();
  const access = authorize(me, roles);
  if (access === "login" || !me) redirect("/login?error=not-staff");
  if (access === "forbidden") {
    const elsewhere = redirectInsteadOfForbidden(me, roles);
    if (elsewhere) redirect(elsewhere);
    forbidden();
  }
  return me;
}
