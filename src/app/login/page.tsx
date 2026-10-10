import { redirect } from "next/navigation";
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
  redirect(next.startsWith("/dashboard") ? next : "/dashboard");
}

const MESSAGES: Record<string, string> = {
  invalid: "That email and password did not match.",
  "not-staff": "This account is not on the Aangan staff list. Ask an admin to add you.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string; confirmed?: string }> }) {
  const { error, next, confirmed } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="text-2xl font-semibold">Aangan Frontdesk</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Staff sign in</p>
      </div>
      {confirmed && <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">Email confirmed. Sign in with your password.</p>}
      {error && MESSAGES[error] && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{MESSAGES[error]}</p>}
      <form action={signIn} className="flex flex-col gap-3">
        <input type="hidden" name="next" value={next ?? "/dashboard"} />
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input name="email" type="email" required autoComplete="email" className="rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Password
          <input name="password" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="current-password" className="rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
        </label>
        <button type="submit" className="mt-2 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900">
          Sign in
        </button>
      </form>
    </main>
  );
}
