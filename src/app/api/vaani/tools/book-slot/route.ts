import { bookingRoute } from "@/lib/booking/route";
import { bookSlot } from "@/lib/booking/handlers";

export const dynamic = "force-dynamic";

export const POST = bookingRoute(bookSlot);
