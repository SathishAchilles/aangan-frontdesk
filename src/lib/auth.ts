import "server-only";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { staff } from "@/db/schema";
import { supabaseServer } from "./supabase/server";

export type CurrentStaff = { id: string; name: string; role: "admin" | "viewer" | "designer" | "front_desk"; email: string | null };

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

export async function requireStaff(roles: CurrentStaff["role"][] = ["admin", "viewer"]): Promise<CurrentStaff> {
  const me = await currentStaff();
  if (!me) redirect("/login?error=not-staff");
  if (!roles.includes(me.role)) redirect("/dashboard?error=forbidden");
  return me;
}
