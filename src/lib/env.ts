import { z } from "zod";

const optionalString = z.string().trim().min(1).optional();
const optionalUrl = z.url().optional();

export const envSchema = z.object({
  DATABASE_URL: optionalUrl,
  DATABASE_MIGRATION_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optionalString,
  DB_SCHEMA: z.enum(["aangan", "aangan_test"]).default("aangan"),
  TOOL_SECRET: optionalString,
  VAANI_API_KEY: optionalString,
  VAANI_AGENT_ID: optionalString,
  VAANI_WEBHOOK_TOKEN: optionalString,
  FRONT_DESK_PHONE: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/, "must be E.164, for example +919876543210")
    .optional(),
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: z.string().default("gemini-3.8-flash"),
  GEMINI_JUDGE_MODEL: z.string().default("gemini-3.1-pro-preview"),
  CALCOM_API_KEY: optionalString,
  CALCOM_WEBHOOK_SECRET: optionalString,
  TELEGRAM_BOT_TOKEN: optionalString,
  TELEGRAM_WEBHOOK_SECRET: optionalString,
  HUBSPOT_PRIVATE_APP_TOKEN: optionalString,
  CRON_SECRET: optionalString,
  AUTH_PASSWORD_SUFFIX: optionalString,
  APP_URL: z.url().default("https://aangan-frontdesk.vercel.app"),
  EVAL_BUDGET_INR: z.coerce.number().positive().default(300),
});

export type Env = z.infer<typeof envSchema>;
export type EnvKey = keyof Env;

// Variables a production build refuses to ship without. Grows as features land.
export const REQUIRED_IN_PRODUCTION: EnvKey[] = ["AUTH_PASSWORD_SUFFIX"];

function blankToUndefined(source: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, value === "" ? undefined : value]),
  );
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(blankToUndefined(source));
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid environment variables:\n  ${problems.join("\n  ")}`);
  }
  return result.data;
}

export function missingRequired(env: Env, required: EnvKey[]): EnvKey[] {
  return required.filter((key) => env[key] === undefined);
}

let cached: Env | undefined;

export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

// Use at the point a feature needs a variable, so the error names it.
export function requireEnv<K extends EnvKey>(key: K): NonNullable<Env[K]> {
  const value = env()[key];
  if (value === undefined) {
    throw new Error(`Missing environment variable ${key}. See .env.example.`);
  }
  return value as NonNullable<Env[K]>;
}
