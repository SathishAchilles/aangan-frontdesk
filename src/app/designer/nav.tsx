"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { withAs } from "@/lib/designer/links";

// Client only to read the path (active state) and to keep an admin's ?as= on every link. Who may
// see what is decided on the server.
const ITEMS: [href: string, label: string, icon: string][] = [
  ["/designer", "My day", "M10 3.5v1.5M10 15v1.5M3.5 10H5M15 10h1.5M5.4 5.4l1 1M13.6 13.6l1 1M5.4 14.6l1-1M13.6 6.4l1-1M10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  ["/designer/calendar", "Calendar", "M3.5 5.5h13v11h-13zM3.5 8.5h13M7 3.5v3M13 3.5v3"],
  ["/designer/leads", "My leads", "M6.5 3.5h-2a1 1 0 0 0-1 1c0 6.6 5.4 12 12 12a1 1 0 0 0 1-1v-2l-3-1.5-1.5 1.5a8 8 0 0 1-5-5L8.5 7 7 3.5z"],
  ["/designer/performance", "Performance", "M3.5 16.5h13M5.5 13l3-4 3 2.5 4-6"],
];

export function DesignerNav() {
  const pathname = usePathname() ?? "";
  const as = useSearchParams()?.get("as") ?? null;
  const isActive = (href: string) => (href === "/designer" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <ul className="flex gap-1 overflow-x-auto md:flex-col md:gap-2 md:overflow-visible">
      {ITEMS.map(([href, label, icon]) => {
        const active = isActive(href);
        return (
          <li key={href} className="shrink-0">
            <Link
              href={withAs(href, as)}
              aria-current={active ? "page" : undefined}
              className={`group relative flex items-center gap-2 rounded-full px-3 py-2 text-sm transition duration-200 ease-out motion-safe:active:scale-95 md:flex-col md:gap-1 md:rounded-2xl md:px-1 md:py-2.5 md:text-[11px] ${
                active ? "bg-rail-active font-medium text-rail-active-ink" : "text-rail-ink hover:bg-rail-hover hover:text-ink"
              }`}
            >
              {active && <span aria-hidden="true" className="rise absolute top-1/2 -left-2.5 hidden h-6 w-1 -translate-y-1/2 rounded-full bg-accent md:block" />}
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 shrink-0 transition-transform duration-200 ease-out motion-safe:group-hover:-translate-y-0.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d={icon} />
              </svg>
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
