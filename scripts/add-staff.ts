// Creates (or links) a dashboard login for a staff member.
// Usage: npm run staff:add -- <email> "<name>" <admin|viewer> [password]
// Passwords need at least 4 characters. Without one, a 4-character password is generated and printed once. If the Supabase project requires email
// confirmation, the person confirms from their inbox (or an admin confirms in the Supabase dashboard).
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { toAuthPassword } from "../src/lib/password";
import postgres from "postgres";

const [email, name, role, given] = process.argv.slice(2);
if (!email || !name || !["admin", "viewer"].includes(role ?? "")) {
  console.error('Usage: npm run staff:add -- <email> "<name>" <admin|viewer> [password]');
  process.exit(2);
}
const url = process.env.DATABASE_MIGRATION_URL;
if (!url || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
  throw new Error("Needs DATABASE_MIGRATION_URL, NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
}
const schema = process.env.DB_SCHEMA === "aangan_test" ? "aangan_test" : "aangan";

async function main() {
  const password = given ?? randomBytes(3).toString("base64url");
  const padded = toAuthPassword(password, process.env.AUTH_PASSWORD_SUFFIX);
  if (!padded.ok) throw new Error(padded.error);
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  let userId: string | undefined;
  const signUp = await supabase.auth.signUp({
    email,
    password: padded.authPassword,
    // Must match an entry in Supabase Auth > URL Configuration > Redirect URLs, or Supabase falls back to the Site URL.
    options: { emailRedirectTo: `${process.env.APP_URL ?? "https://aangan-frontdesk.vercel.app"}/login?confirmed=1` },
  });
  if (signUp.error && !/already registered|already exists/i.test(signUp.error.message)) throw signUp.error;
  userId = signUp.data.user?.id;
  if (!userId) {
    const signIn = await supabase.auth.signInWithPassword({ email, password: padded.authPassword });
    if (signIn.error) throw new Error(`Account exists; pass its current password to link it (${signIn.error.message})`);
    userId = signIn.data.user.id;
  }

  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  try {
    const [row] = await sql<{ id: string }[]>`
      insert into ${sql(`${schema}.staff`)} (auth_user_id, name, email, role)
      values (${userId}, ${name}, ${email}, ${role})
      on conflict (auth_user_id) do update set name = excluded.name, email = excluded.email, role = excluded.role, active = true
      returning id`;
    console.log(`staff ${row.id}: ${name} <${email}> as ${role}`);
  } finally {
    await sql.end();
  }
  if (!given) console.log(`password (shown once): ${password}`);
  if (signUp.data.user && !signUp.data.session) console.log("Email confirmation is on: confirm from the inbox before signing in.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
