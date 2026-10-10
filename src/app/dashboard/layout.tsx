import Link from "next/link";
import type { ReactNode } from "react";
import { requireStaff } from "@/lib/auth";

export const dynamic = "force-dynamic";

const NAV = [
  ["/dashboard", "Overview"],
  ["/dashboard/calls", "Calls"],
  ["/dashboard/designers", "Designers"],
  ["/dashboard/costs", "Costs"],
  ["/dashboard/quality", "Quality"],
  ["/dashboard/settings", "Settings"],
];

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const me = await requireStaff(["admin", "viewer"]);
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <Link href="/dashboard" className="text-lg font-semibold">
          Aangan Frontdesk
        </Link>
        <nav className="flex flex-wrap gap-4 text-sm">
          {NAV.filter(([href]) => me.role === "admin" || href !== "/dashboard/settings").map(([href, label]) => (
            <Link key={href} href={href} className="text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50">
              {label}
            </Link>
          ))}
        </nav>
        <span className="text-xs text-zinc-500">
          {me.name} · {me.role}
        </span>
      </header>
      {children}
    </div>
  );
}
