// Creates or updates the "Aangan Front Desk" Vaani agent from prompts/agent.md and src/lib/agent/spec.ts.
// Usage: npm run vaani:sync
// Needs VAANI_API_KEY, TOOL_SECRET and FRONT_DESK_PHONE; APP_URL defaults to production.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { syncAgent } from "../src/lib/agent/vaani-sync";
import { toE164 } from "../src/lib/phone";

const need = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

async function main() {
  const frontDeskPhone = toE164(need("FRONT_DESK_PHONE"));
  if (!frontDeskPhone) throw new Error("FRONT_DESK_PHONE is not a valid phone number");
  const result = await syncAgent(
    {
      prompt: readFileSync(join(process.cwd(), "prompts", "agent.md"), "utf8"),
      appUrl: process.env.APP_URL ?? "https://aangan-frontdesk.vercel.app",
      toolSecret: need("TOOL_SECRET"),
      frontDeskPhone,
      gitSha: process.env.GITHUB_SHA,
    },
    { apiKey: need("VAANI_API_KEY"), fetch },
  );
  console.log(`${result.created ? "created" : "updated"} agent ${result.agentId}`);
  console.log(`prompt version ${result.promptVersion}; tools: ${result.functions.join(", ")}`);
  console.log(`transfer goes to ${result.transferPhone ? `••••${result.transferPhone.slice(-4)}` : "(not set)"}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
