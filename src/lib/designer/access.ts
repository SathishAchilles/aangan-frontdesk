// Who the designer area is showing, decided on the server from the session alone.
// A designer always sees themselves (an `as` in the URL is ignored). An admin may look at any active
// designer's area with ?as=<staffId>, read-only. Everyone else gets a 403 from requireStaff.
import "server-only";
import { forbidden, redirect } from "next/navigation";
import { rawSql } from "@/db/client";
import { SCHEMA_NAME } from "@/db/schema";
import { type CurrentStaff, requireStaff } from "@/lib/auth";
import { DESIGNER_AREA_ROLES } from "@/lib/authz";
import { type Designer, loadDesigner } from "./queries";

export type DesignerView = {
  viewer: CurrentStaff;
  designer: Designer;
  // True for an admin viewing as a designer: no action may be taken.
  readOnly: boolean;
  // The `as` to carry on links, set only in view-as mode.
  as: string | null;
};

export async function requireDesignerView(as?: string | string[]): Promise<DesignerView> {
  const viewer = await requireStaff(DESIGNER_AREA_ROLES);
  if (viewer.role === "designer") {
    const designer = await loadDesigner(rawSql(), SCHEMA_NAME, viewer.id);
    if (!designer) forbidden();
    return { viewer, designer, readOnly: false, as: null };
  }
  const designer = await loadDesigner(rawSql(), SCHEMA_NAME, typeof as === "string" ? as : undefined);
  if (!designer) redirect("/designer/view-as");
  return { viewer, designer, readOnly: true, as: designer.id };
}

// For server actions: only a signed-in designer acts, always as themselves. Admins viewing as a
// designer are refused here, whatever the form says.
export async function requireActingDesigner(): Promise<Designer> {
  const me = await requireStaff(["designer"]);
  const designer = await loadDesigner(rawSql(), SCHEMA_NAME, me.id);
  if (!designer) forbidden();
  return designer;
}
