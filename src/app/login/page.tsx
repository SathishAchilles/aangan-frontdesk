import { redirect } from "next/navigation";
import { safeNext } from "@/lib/authz";
import { MIN_PASSWORD_LENGTH, toAuthPassword } from "@/lib/password";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function signIn(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/dashboard");
  const padded = toAuthPassword(password, process.env.AUTH_PASSWORD_SUFFIX);
  if (!padded.ok) redirect(`/login?error=invalid&next=${encodeURIComponent(next)}`);
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password: padded.authPassword });
  if (error) redirect(`/login?error=invalid&next=${encodeURIComponent(next)}`);
  // Designers who land on the dashboard are sent on to /designer by requireStaff.
  redirect(safeNext(next));
}

const MESSAGES: Record<string, string> = {
  invalid: "That email and password did not match.",
  "not-staff": "This account is not on the Aangan staff list. Ask an admin to add you.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string; confirmed?: string }> }) {
  const { error, next, confirmed } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <div className="flex flex-col gap-6 rounded-[32px] border border-line bg-surface p-6 shadow-card sm:p-10">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="relative block h-9 w-10 shrink-0">
            <span className="absolute top-0 left-0 h-6 w-8 rounded-full bg-chart-2" />
            <span className="absolute right-0 bottom-0 h-7 w-6 rounded-full bg-accent/90" />
          </span>
          <div>
            <h1 className="text-2xl font-light tracking-tight text-ink">Aangan Frontdesk</h1>
            <p className="text-sm text-ink-muted">Staff sign in</p>
          </div>
        </div>
        {confirmed && <p className="rounded-2xl bg-ok-bg px-4 py-3 text-sm font-medium text-ok">Email confirmed. Sign in with your password.</p>}
        {error && MESSAGES[error] && <p className="rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger">{MESSAGES[error]}</p>}
        <form action={signIn} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next ?? "/dashboard"} />
          <label className="flex flex-col gap-1.5 text-sm text-ink-muted">
            Email
            <input name="email" type="email" required autoComplete="email" className="rounded-full border border-line bg-surface-2 px-4 py-2.5 text-ink focus-visible:border-accent" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-ink-muted">
            Password
            <input name="password" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="current-password" className="rounded-full border border-line bg-surface-2 px-4 py-2.5 text-ink focus-visible:border-accent" />
          </label>
          <button type="submit" className="mt-2 rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink transition hover:opacity-90">
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
