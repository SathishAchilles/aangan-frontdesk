import { lookupCaller } from "@/lib/tools/handlers";
import { toolRoute } from "@/lib/tools/route";

export const dynamic = "force-dynamic";

export const POST = toolRoute(lookupCaller);
