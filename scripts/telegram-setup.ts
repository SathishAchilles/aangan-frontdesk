// One-time Telegram setup, after you have:
//   1. created a bot with @BotFather and put its token in .env.local as TELEGRAM_BOT_TOKEN,
//   2. created two groups ("Aangan Designers", "Aangan Front Desk"), added the bot to both,
//   3. sent one message in each group, and one direct message to the bot from the founder's account.
// Usage: npm run telegram:setup            -> lists chats the bot can see
//        npm run telegram:setup -- save <designersChatId> <frontDeskChatId> <founderChatId>
//        npm run telegram:setup -- webhook   -> registers https://<APP_URL>/api/webhooks/telegram
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("Set TELEGRAM_BOT_TOKEN in .env.local first");
const api = async <T>(method: string, body: Record<string, unknown> = {}) => {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json()) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(`${method}: ${json.description}`);
  return json.result;
};

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const me = await api<{ username: string }>("getMe");
  console.log(`bot: @${me.username}`);

  if (!command) {
    await api("deleteWebhook");
    const updates = await api<{ message?: { chat: { id: number; type: string; title?: string; first_name?: string }; from?: { id: number; first_name?: string } } }[]>("getUpdates");
    const chats = new Map<number, string>();
    const people = new Map<number, string>();
    for (const update of updates) {
      const message = update.message;
      if (!message) continue;
      chats.set(message.chat.id, `${message.chat.type}: ${message.chat.title ?? message.chat.first_name ?? ""}`);
      if (message.from) people.set(message.from.id, message.from.first_name ?? "");
    }
    console.log("chats:");
    for (const [id, label] of chats) console.log(`  ${id}  ${label}`);
    console.log("people (use their ids as staff.telegram_user_id):");
    for (const [id, name] of people) console.log(`  ${id}  ${name}`);
    console.log("Next: npm run telegram:setup -- save <designers> <frontDesk> <founder>");
    return;
  }

  if (command === "save") {
    const [designers, frontDesk, founder] = rest.map(Number);
    if (![designers, frontDesk, founder].every(Number.isFinite)) throw new Error("save needs three chat ids");
    execFileSync("npx", ["tsx", "--env-file-if-exists=.env.local", "scripts/set-setting.ts", "telegram_chats", JSON.stringify({ designers, front_desk: frontDesk, founder }), "Telegram chats configured"], { stdio: "inherit" });
    return;
  }

  if (command === "webhook") {
    const env = readFileSync(".env.local", "utf8");
    let secret = env.match(/^TELEGRAM_WEBHOOK_SECRET=(.+)$/m)?.[1];
    if (!secret) {
      secret = randomBytes(32).toString("hex");
      appendFileSync(".env.local", `TELEGRAM_WEBHOOK_SECRET=${secret}\n`);
      console.log("generated TELEGRAM_WEBHOOK_SECRET in .env.local (add it to Vercel too)");
    }
    const appUrl = (process.env.APP_URL ?? "https://aangan-frontdesk.vercel.app").replace(/\/$/, "");
    await api("setWebhook", { url: `${appUrl}/api/webhooks/telegram`, secret_token: secret, allowed_updates: ["callback_query"] });
    const info = await api<{ url: string; pending_update_count: number }>("getWebhookInfo");
    console.log(`webhook: ${info.url} (pending ${info.pending_update_count})`);
    return;
  }
  throw new Error(`Unknown command ${command}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
