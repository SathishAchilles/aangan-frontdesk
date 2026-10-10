import Link from "next/link";
import type { ReactNode } from "react";
import { requireStaff } from "@/lib/auth";
import { NavLinks } from "./nav";

export const dynamic = "force-dynamic";

const NAV: [string, string][] = [
  ["/dashboard", "Overview"],
  ["/dashboard/calls", "Calls"],
  ["/dashboard/designers", "Designers"],
  ["/dashboard/costs", "Costs"],
  ["/dashboard/quality", "Quality"],
  ["/dashboard/settings", "Settings"],
];

function Mark() {
  return (
    <span aria-hidden="true" className="relative block h-9 w-10">
      <span className="absolute top-0 left-0 h-6 w-8 rounded-full bg-chart-2 transition-transform duration-300 ease-out motion-safe:group-hover:-translate-x-0.5" />
      <span className="absolute right-0 bottom-0 h-7 w-6 rounded-full bg-accent/90 transition-transform duration-300 ease-out motion-safe:group-hover:translate-x-0.5" />
    </span>
  );
}

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const me = await requireStaff(["admin", "viewer"]);
  const initial = me.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col md:flex-row md:gap-8 md:p-6 lg:p-8">
      <aside className="border-b border-line bg-rail md:sticky md:top-6 md:flex md:h-[calc(100vh-3rem)] lg:top-8 lg:h-[calc(100vh-4rem)] md:w-[92px] md:shrink-0 md:flex-col md:items-center md:rounded-[32px] md:border md:py-6 md:shadow-card">
        <div className="flex items-center justify-between gap-3 px-4 pt-4 md:flex-col md:px-0 md:pt-0">
          <Link href="/dashboard" className="group flex items-center gap-3 rounded-2xl text-ink md:flex-col">
            <Mark />
            <span className="text-base font-medium md:sr-only">Aangan Frontdesk</span>
          </Link>
          <span className="flex items-center gap-2 text-xs text-ink-muted md:hidden">
            <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-full bg-accent-soft text-sm font-medium text-accent-soft-ink">
              {initial}
            </span>
            {me.name} · {me.role}
          </span>
        </div>
        <nav aria-label="Dashboard" className="px-3 py-3 md:mt-10 md:w-full md:px-2.5 md:py-0">
          <NavLinks items={NAV.filter(([href]) => me.role === "admin" || href !== "/dashboard/settings")} />
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col gap-8 px-4 py-6 md:px-0 md:py-0">
        <header className="hidden items-center justify-between gap-4 md:flex">
          <div className="flex flex-col">
            <span className="text-xs tracking-widest text-ink-soft uppercase">Aangan Studio · Pune</span>
            <Link href="/dashboard" className="text-lg font-medium text-ink">
              Aangan Frontdesk
            </Link>
          </div>
          <span className="flex items-center gap-3 rounded-full border border-line bg-surface py-1.5 pr-4 pl-1.5 text-xs text-ink-muted shadow-card">
            <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-full bg-accent-soft text-sm font-medium text-accent-soft-ink">
              {initial}
            </span>
            {me.name} · {me.role}
          </span>
        </header>
        {children}
      </div>
    </div>
  );
}
