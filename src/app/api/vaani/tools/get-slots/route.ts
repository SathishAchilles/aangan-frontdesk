import { bookingRoute } from "@/lib/booking/route";
import { getSlots } from "@/lib/booking/handlers";

export const dynamic = "force-dynamic";

export const POST = bookingRoute(getSlots);
