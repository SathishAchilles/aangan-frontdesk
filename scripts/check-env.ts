// Runs before `next build`. Production builds fail if a required variable is missing.
import { missingRequired, parseEnv, REQUIRED_IN_PRODUCTION } from "../src/lib/env";

const isProduction = process.env.VERCEL_ENV === "production";
const env = parseEnv(process.env);
const missing = missingRequired(env, REQUIRED_IN_PRODUCTION);

if (missing.length > 0) {
  const message = `Missing environment variables: ${missing.join(", ")}. See .env.example.`;
  if (isProduction) {
    console.error(message);
    process.exit(1);
  }
  console.warn(`${message} (warning only outside production)`);
}
