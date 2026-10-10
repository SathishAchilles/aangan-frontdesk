import Link from "next/link";

export default function Forbidden() {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="flex flex-col gap-3 rounded-[32px] border border-line bg-surface p-6 shadow-card sm:p-10">
        <span className="w-fit rounded-full bg-danger-bg px-3 py-1 text-xs font-medium text-danger">403</span>
        <h1 className="text-2xl font-light tracking-tight text-ink">Not allowed</h1>
        <p className="text-ink-muted">Only admins can open this page.</p>
        <Link href="/dashboard" className="mt-2 w-fit rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition hover:opacity-90">
          Back to the dashboard
        </Link>
      </div>
    </main>
  );
}
