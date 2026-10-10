import Link from "next/link";

const steps = [
  ["Answers", "Every call to the studio, day or night, in English."],
  ["Qualifies", "Checks the enquiry against the studio's five rules while the caller is on the line."],
  ["Books", "Offers real consultation slots and books one on the call."],
  ["Hands off", "Sends the designer a note with everything already asked."],
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-10 px-4 py-16">
      <div className="flex flex-col gap-3">
        <p className="text-sm uppercase tracking-widest text-zinc-500">Aangan Studio · Pune</p>
        <h1 className="text-4xl font-semibold tracking-tight">Aangan Frontdesk</h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          The studio&apos;s AI front desk. It never quotes prices: pricing depends on the site, the materials and the scope, so that conversation happens with a designer.
        </p>
      </div>
      <ol className="grid gap-4 sm:grid-cols-2">
        {steps.map(([title, body], index) => (
          <li key={title} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="text-sm text-zinc-500">{index + 1}</p>
            <p className="font-medium">{title}</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{body}</p>
          </li>
        ))}
      </ol>
      <div>
        <Link href="/login" className="inline-block rounded-md bg-zinc-900 px-4 py-2 text-white dark:bg-zinc-100 dark:text-zinc-900">
          Staff sign in
        </Link>
      </div>
    </main>
  );
}
