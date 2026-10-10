import Link from "next/link";

const steps = [
  ["Answers", "Every call to the studio, day or night, in English."],
  ["Qualifies", "Checks the enquiry against the studio's five rules while the caller is on the line."],
  ["Books", "Offers real consultation slots and books one on the call."],
  ["Hands off", "Sends the designer a note with everything already asked."],
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center gap-10 px-4 py-16 sm:px-6">
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr] lg:items-stretch">
        <div className="flex flex-col justify-center gap-4">
          <p className="text-sm tracking-widest text-ink-soft uppercase">Aangan Studio · Pune</p>
          <h1 className="text-4xl font-light tracking-tight text-ink sm:text-5xl">Aangan Frontdesk</h1>
          <p className="max-w-xl text-lg text-ink-muted">
            The studio&apos;s AI front desk. It never quotes prices: pricing depends on the site, the materials and the scope, so that conversation happens with a designer.
          </p>
          <div className="pt-2">
            <Link href="/login" className="inline-block rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink transition hover:opacity-90">
              Staff sign in
            </Link>
          </div>
        </div>
        <div aria-hidden="true" className="relative hidden overflow-hidden rounded-[32px] border border-line bg-surface-2 p-6 shadow-card lg:block">
          <div className="flex flex-col gap-4 rounded-3xl bg-accent p-6 text-accent-ink">
            <span className="text-sm text-accent-ink/85">Every call</span>
            <span className="text-4xl font-light tracking-tight">answered</span>
            <span className="block h-1 w-full rounded-full bg-accent-ink/20">
              <span className="block h-full w-full rounded-full bg-accent-ink/75" />
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 text-ink-muted">
            <div className="rounded-3xl border border-line bg-surface p-4 text-sm">Qualified on the line</div>
            <div className="rounded-3xl border border-line bg-surface p-4 text-sm">Booked with a designer</div>
          </div>
        </div>
      </div>
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map(([title, body], index) => (
          <li key={title} className="flex flex-col gap-2 rounded-3xl border border-line bg-surface p-6 shadow-card">
            <span className={`grid h-8 w-8 place-items-center rounded-full text-sm font-medium ${index === 0 ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink-muted"}`}>{index + 1}</span>
            <p className="text-lg font-normal text-ink">{title}</p>
            <p className="text-sm text-ink-muted">{body}</p>
          </li>
        ))}
      </ol>
    </main>
  );
}
