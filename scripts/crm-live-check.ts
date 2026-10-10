// Live check of the HubSpot integration: syncs one test enquiry through new -> booked -> won using the
// real sync code, reads each stage back from HubSpot, then archives the test contact and deal.
// Usage: npm run crm:check
import { createHubspotClient, type CrmEnquiry, type CrmLinkRepo, type CrmStageKey, syncEnquiryToCrm } from "../src/lib/crm";

const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
if (!token) throw new Error("Set HUBSPOT_PRIVATE_APP_TOKEN in .env.local");
const BASE = "https://api.hubapi.com";
const STAGES: Record<CrmStageKey, string> = { new: "Qualified To Buy", booked: "Appointment Scheduled", won: "Closed Won", lost: "Closed Lost" };

async function hubspot<T>(method: string, path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

async function main() {
  const client = createHubspotClient(token!);
  const stored = new Map<string, { contactId: string | null; dealId: string | null }>();
  const links: CrmLinkRepo = {
    getLink: async (id) => stored.get(id) ?? null,
    saveLink: async (id, link) => void stored.set(id, link),
    clearSyncFlag: async () => {},
  };
  const { stages } = await client.dealStages();
  const labelOf = new Map(stages.map((stage) => [stage.id, stage.label]));
  // A test number that is not a real subscriber line.
  const enquiry: CrmEnquiry = { id: "crm-live-check", outcome: "QUALIFIED", phone: "+919000000000", callerName: "Aangan Test Lead", locality: "Baner", scope: "full home", booked: false, result: null };
  let contactId: string | null = null;
  let dealId: string | null = null;
  try {
    for (const step of [{}, { booked: true }, { booked: true, result: "won" as const }]) {
      const result = await syncEnquiryToCrm({ ...enquiry, ...step }, { client, links, stageLabels: STAGES });
      contactId = result.contactId;
      dealId = result.dealId;
      const deal = await hubspot<{ properties: { dealstage: string; dealname: string } }>("GET", `/crm/v3/objects/deals/${dealId}?properties=dealstage,dealname`);
      const label = labelOf.get(deal.properties.dealstage);
      const ok = label === STAGES[result.stage!];
      console.log(`${ok ? "ok  " : "FAIL"} stage ${result.stage}: HubSpot shows "${label}" on deal "${deal.properties.dealname}"`);
      if (!ok) process.exitCode = 1;
    }
    const contacts = new Set([...stored.values()].map((link) => link.contactId));
    console.log(`${contacts.size === 1 ? "ok  " : "FAIL"} one contact reused across all three syncs`);
  } finally {
    if (dealId) await hubspot("DELETE", `/crm/v3/objects/deals/${dealId}`);
    if (contactId) await hubspot("DELETE", `/crm/v3/objects/contacts/${contactId}`);
    console.log("cleaned up: test deal and contact archived");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
