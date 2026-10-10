import Link from "next/link";

export default function Forbidden() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center gap-3 px-4">
      <h1 className="text-2xl font-semibold">Not allowed</h1>
      <p className="text-zinc-600 dark:text-zinc-400">Only admins can open this page.</p>
      <Link href="/dashboard" className="underline underline-offset-4">
        Back to the dashboard
      </Link>
    </main>
  );
}
