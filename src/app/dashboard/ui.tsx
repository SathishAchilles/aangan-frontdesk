import Link from "next/link";
import type { ReactNode } from "react";
import type { Range } from "@/lib/dashboard/metrics";

export function Card({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 ${className}`}>
      {title && <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{title}</h2>}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, href }: { label: string; value: ReactNode; hint?: string; href?: string }) {
  const body = (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-sm text-zinc-600 dark:text-zinc-400">{label}</div>
      {hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="hover:opacity-80">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Table({ head, rows, empty = "Nothing here yet." }: { head: string[]; rows: ReactNode[][]; empty?: string }) {
  if (rows.length === 0) return <p className="text-sm text-zinc-500">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
            {head.map((cell) => (
              <th key={cell} className="py-2 pr-4 font-medium">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-zinc-100 dark:border-zinc-900">
              {row.map((cell, j) => (
                <td key={j} className="py-2 pr-4 align-top tabular-nums">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RangePicker({ range, path }: { range: Range; path: string }) {
  return (
    <form action={path} className="flex flex-wrap items-end gap-2 text-sm">
      <label className="flex flex-col gap-1">
        From
        <input type="date" name="from" defaultValue={range.from} className="rounded-md border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      <label className="flex flex-col gap-1">
        To (exclusive)
        <input type="date" name="to" defaultValue={range.to} className="rounded-md border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      <button className="rounded-md border border-zinc-300 px-3 py-1 dark:border-zinc-700">Apply</button>
    </form>
  );
}

export const inr = (value: number | null | undefined) =>
  value === null || value === undefined ? "-" : `₹${value.toLocaleString("en-IN", { maximumFractionDigits: value < 100 ? 2 : 0 })}`;
export const pct = (value: number | null | undefined) => (value === null || value === undefined ? "-" : `${Math.round(value * 100)}%`);
export const istTime = (date: Date | null) =>
  date ? new Date(date.getTime() + 330 * 60_000).toISOString().replace("T", " ").slice(0, 16) : "-";

export const OUTCOME_LABEL: Record<string, string> = {
  QUALIFIED: "Qualified",
  QUALIFIED_WITH_NOTES: "Qualified, with notes",
  NOT_QUALIFIED: "Not qualified",
  NEEDS_HUMAN: "Needs a person",
  NOT_ENQUIRY: "Not an enquiry",
  PENDING: "Pending (call ended early)",
};
export const CRITERION_LABEL: Record<string, string> = { C1: "Real project", C2: "Service area", C3: "Timeline", C4: "Budget", C5: "Decision-maker" };
