// Staff choose a short password (at least 4 characters). Supabase Auth refuses anything under 6, so
// the app appends a secret suffix before every sign-up and sign-in. The suffix must never change once
// accounts exist, or every staff password stops working.
export const MIN_PASSWORD_LENGTH = 4;

export type PasswordResult = { ok: true; authPassword: string } | { ok: false; error: string };

export function toAuthPassword(password: string, suffix: string | undefined): PasswordResult {
  if (!suffix || suffix.length < 16) return { ok: false, error: "AUTH_PASSWORD_SUFFIX is not set (16+ characters)" };
  if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  return { ok: true, authPassword: `${password}${suffix}` };
}
