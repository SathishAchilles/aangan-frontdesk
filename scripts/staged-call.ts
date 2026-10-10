// Sends one staged, qualified call through production exactly as Vaani would: the mid-call
// evaluate_enquiry tool, then call_started / call_ended / call_postprocessing webhooks. Then runs the
// follow-ups job once and waits for the designer handoff to be posted to Telegram.
// Usage: npm run staged-call            -> send the call, report call-end -> handoff-posted time
//        npm run staged-call -- --cleanup -> remove every staged call's rows and archive its HubSpot records
import postgres from "postgres";

const PHONE = "+919000000001";
const APP = (process.env.APP_URL ?? "https://aangan-frontdesk.vercel.app").replace(/\/$/, "");
const need = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set in .env.local`);
  return value;
};
const sql = postgres(need("DATABASE_MIGRATION_URL"), { max: 1, onnotice: () => {} });
const t = (name: string) => sql(`aangan.${name}`);

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${APP}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

async function send() {
  const room = `staged-${Date.now()}`;
  const evaluation = await post(
    "/api/vaani/tools/evaluate-enquiry",
    {
      phone: PHONE,
      facts: {
        project_type: "residential",
        execution: "yes",
        scope_text: "TEST staged call: redo the whole 3BHK",
        full_home: true,
        sqft: 1400,
        locality: "Kothrud",
        deadline_text: "done by June",
        decision_text: "I'm the owner",
      },
    },
    { "x-tool-key": need("TOOL_SECRET") },
  );
  console.log(`evaluate_enquiry: ${evaluation.outcome} (enquiry ${evaluation.enquiry_id})`);

  const webhook = `/api/webhooks/vaani?token=${encodeURIComponent(need("VAANI_WEBHOOK_TOKEN"))}`;
  const transcript = [
    "[11:01:02] AGENT: Hello, thank you for calling Aangan Studio. I'm the studio's AI assistant, and this call is recorded. How can I help you today?",
    "[11:01:09] USER: This is a test call. I want my 3BHK in Kothrud redone by June. It's about 1400 square feet and I'm the owner.",
    "[11:01:30] AGENT: Thank you. A designer from our team will call you to talk it through.",
  ].join("\n\n");
  await post(webhook, { event: "call_started", room_name: room, status: "dialing", phone_number: PHONE });
  await post(webhook, { event: "call_ended", room_name: room, call_duration: 95, end_reason: "AGENT_REQUESTED_DISCONNECT" });
  const endedAt = Date.now();
  await post(webhook, { event: "call_postprocessing", call_id: room, data: { room_name: room, call_duration: 95000, transcript, summary: "TEST staged call: 3BHK in Kothrud" } });
  console.log(`webhooks delivered for ${room}`);

  await post("/api/cron/followups", {}, { authorization: `Bearer ${need("CRON_SECRET")}` });
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const [handoff] = await sql<{ posted_at: Date | null; message_id: number | null }[]>`
      select h.posted_at, h.message_id from ${t("handoffs")} h where h.enquiry_id = ${evaluation.enquiry_id}`;
    if (handoff?.posted_at) {
      console.log(`handoff posted to Telegram ${((handoff.posted_at.getTime() - endedAt) / 1000).toFixed(1)} s after the call ended`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
    if (attempt === 5) await post("/api/cron/followups", {}, { authorization: `Bearer ${need("CRON_SECRET")}` });
  }
  throw new Error("No handoff posted within 2 minutes");
}

async function cleanup() {
  const callers = await sql<{ id: string }[]>`select id from ${t("callers")} where phone_e164 = ${PHONE}`;
  const ids = callers.map((caller) => caller.id);
  if (ids.length === 0) return console.log("nothing to clean up");
  const enquiries = (await sql<{ id: string }[]>`select id from ${t("enquiries")} where caller_id in ${sql(ids)}`).map((row) => row.id);
  const links = enquiries.length ? await sql<{ contact_id: string | null; deal_id: string | null }[]>`select hubspot_contact_id as contact_id, hubspot_deal_id as deal_id from ${t("crm_links")} where enquiry_id in ${sql(enquiries)}` : [];
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  for (const link of links) {
    for (const [kind, id] of [["deals", link.deal_id], ["contacts", link.contact_id]] as const) {
      if (id && token) await fetch(`https://api.hubapi.com/crm/v3/objects/${kind}/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    }
  }
  const calls = (await sql<{ id: string; vaani_call_id: string }[]>`select id, vaani_call_id from ${t("calls")} where caller_id in ${sql(ids)}`);
  await sql.begin(async (tx) => {
    if (enquiries.length) {
      for (const table of ["cost_lines", "handoffs", "tasks", "bookings", "crm_links"]) await tx`delete from ${tx(`aangan.${table}`)} where enquiry_id in ${tx(enquiries)}`;
    }
    if (calls.length) {
      await tx`delete from ${tx("aangan.cost_lines")} where call_id in ${tx(calls.map((call) => call.id))}`;
      await tx`delete from ${tx("aangan.calls")} where id in ${tx(calls.map((call) => call.id))}`;
      await tx`delete from ${tx("aangan.inbox")} where source = 'vaani' and payload::text like any (${calls.map((call) => `%${call.vaani_call_id}%`)})`;
    }
    if (enquiries.length) await tx`delete from ${tx("aangan.enquiries")} where id in ${tx(enquiries)}`;
    await tx`delete from ${tx("aangan.callers")} where id in ${tx(ids)}`;
  });
  console.log(`removed ${enquiries.length} enquiries, ${calls.length} calls and ${links.length} HubSpot links for ${PHONE}`);
}

(process.argv.includes("--cleanup") ? cleanup() : send())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
