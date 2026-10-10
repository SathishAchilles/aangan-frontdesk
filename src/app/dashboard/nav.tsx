"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Client only to read the current path for the active state; the role filter happens in the server layout.
const ICONS: Record<string, string> = {
  "/dashboard": "M3 10.5 10 4l7 6.5M5 9v7h4v-4h2v4h4V9",
  "/dashboard/calls": "M6.5 3.5h-2a1 1 0 0 0-1 1c0 6.6 5.4 12 12 12a1 1 0 0 0 1-1v-2l-3-1.5-1.5 1.5a8 8 0 0 1-5-5L8.5 7 7 3.5z",
  "/dashboard/designers": "M7.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM2.5 16a5 5 0 0 1 10 0M13 4.3a2.5 2.5 0 0 1 0 4.4M15 11.5a5 5 0 0 1 2.5 4.5",
  "/dashboard/costs": "M3 6h14v9H3zM3 9h14M6 12.5h3",
  "/dashboard/quality": "M10 3l2 4.2 4.5.6-3.3 3.1.8 4.5L10 13.2 6 15.4l.8-4.5L3.5 7.8 8 7.2z",
  "/designer/view-as": "M2.5 10s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5zM10 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z",
  "/dashboard/settings": "M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4",
};

export function NavLinks({ items }: { items: [string, string][] }) {
  const pathname = usePathname() ?? "";
  const isActive = (href: string) => (href === "/dashboard" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <ul className="flex gap-1 overflow-x-auto md:flex-col md:gap-2 md:overflow-visible">
      {items.map(([href, label]) => {
        const active = isActive(href);
        return (
          <li key={href} className="shrink-0">
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={`group relative flex items-center gap-2 rounded-full px-3 py-2 text-sm transition duration-200 ease-out motion-safe:active:scale-95 md:flex-col md:gap-1 md:rounded-2xl md:px-1 md:py-2.5 md:text-[11px] ${
                active ? "bg-rail-active font-medium text-rail-active-ink" : "text-rail-ink hover:bg-rail-hover hover:text-ink"
              }`}
            >
              {active && <span aria-hidden="true" className="rise absolute top-1/2 -left-2.5 hidden h-6 w-1 -translate-y-1/2 rounded-full bg-accent md:block" />}
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 shrink-0 transition-transform duration-200 ease-out motion-safe:group-hover:-translate-y-0.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d={ICONS[href] ?? ICONS["/dashboard"]} />
              </svg>
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
