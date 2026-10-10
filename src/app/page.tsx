const stats = [
  { value: "~200", label: "enquiries a month" },
  { value: "48%", label: "no reply within 48 hours" },
  { value: "33%", label: "arrive after hours" },
  { value: "4x", label: "conversion when answered within an hour" },
];

const stack = [
  ["Telephony", "Vaani-provisioned number now, Vobiz later"],
  ["Vaani", "Live voice agent, English, tools called mid-call"],
  ["Gemini", "After the call: fields and handoff note"],
  ["Vercel", "Tool endpoints, webhooks, dashboard"],
  ["Supabase", "System of record, pg_cron follow-ups"],
  ["Cal.com", "Booking during the call"],
  ["Telegram", "Designer handoff, alerts, front-desk tasks"],
  ["HubSpot", "Contacts, deals, nurture tasks"],
  ["GitHub", "Code and prompts, deploys to Vercel"],
];

const outcomes = [
  ["Qualified", "Book on the call, hand off to a designer"],
  ["Qualified with notes", "Budget or decision-maker unclear: book, flag in the note"],
  ["Not qualified", "Close gracefully on the call"],
  ["Needs a person", "Transfer, or a front-desk callback"],
  ["Not an enquiry", "Existing client: urgent alert to a senior"],
];

const roadmap = [
  "Outline and deploy",
  "Database schema and settings",
  "Mid-call tools and the gate",
  "Vaani agent wiring",
  "Post-call pipeline",
  "Follow-ups with pg_cron",
  "Founder dashboard and admin settings",
  "Switch telephony to Vobiz",
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-12 px-4 py-16 sm:px-8">
      <header className="flex flex-col gap-4">
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          Aangan Studio, Pune &middot; MESA Case 03 &middot; outline
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">Aangan Frontdesk</h1>
        <p className="text-lg leading-8 text-zinc-600 dark:text-zinc-300">
          An AI front desk that answers every inbound call, day or night, checks the caller against
          the founder&apos;s five rules, books a consultation on the call, and hands qualified leads
          to a designer with everything already asked.
        </p>
      </header>

      <Section title="The problem">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-2xl font-semibold">{s.value}</div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">{s.label}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Scope">
        <p className="leading-7 text-zinc-700 dark:text-zinc-300">
          Inbound phone calls only. WhatsApp and the web form join later at the input layer.
        </p>
      </Section>

      <Section title="The Cut">
        <p className="leading-7 text-zinc-700 dark:text-zinc-300">
          Per-square-foot price quoting is not built. The studio&apos;s pricing guide says no number
          may be quoted to a client, so the agent gives the approved line and offers to book.
        </p>
      </Section>

      <Section title="Gate outcomes">
        <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
          {outcomes.map(([name, action]) => (
            <li key={name} className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-6">
              <span className="font-medium sm:w-48">{name}</span>
              <span className="text-zinc-600 dark:text-zinc-400">{action}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Stack">
        <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
          {stack.map(([tool, job]) => (
            <li key={tool} className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-6">
              <span className="font-medium sm:w-48">{tool}</span>
              <span className="text-zinc-600 dark:text-zinc-400">{job}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Roadmap">
        <ol className="flex flex-col gap-2">
          {roadmap.map((step, i) => (
            <li key={step} className="flex gap-3">
              <span className="w-6 text-zinc-500 dark:text-zinc-400">{i + 1}.</span>
              <span className={i === 0 ? "font-medium" : "text-zinc-700 dark:text-zinc-300"}>
                {step}
                {i === 0 ? " (done)" : ""}
              </span>
            </li>
          ))}
        </ol>
      </Section>

      <footer className="border-t border-zinc-200 pt-6 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <a
          className="underline underline-offset-4"
          href="https://github.com/SathishAchilles/aangan-frontdesk"
        >
          Source on GitHub
        </a>
      </footer>
    </main>
  );
}
