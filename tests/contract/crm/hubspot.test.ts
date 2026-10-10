import { describe, expect, it } from "vitest";
import { type CrmEnquiry, type CrmLinkRepo, createHubspotClient, stageFor, syncEnquiryToCrm } from "../../../src/lib/crm";

const PIPELINES = {
  results: [
    {
      id: "default",
      label: "Sales Pipeline",
      stages: [
        { id: "appointmentscheduled", label: "Appointment Scheduled" },
        { id: "qualifiedtobuy", label: "Qualified To Buy" },
        { id: "closedwon", label: "Closed Won" },
        { id: "closedlost", label: "Closed Lost" },
      ],
    },
  ],
};
const LABELS = { new: "Qualified To Buy", booked: "Appointment Scheduled", won: "Closed Won", lost: "Closed Lost" };

type Recorded = { method: string; path: string; body?: unknown };

function recordingFetch(responses: Record<string, (body: unknown) => { status: number; json?: unknown; headers?: Record<string, string> }>) {
  const calls: Recorded[] = [];
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    const path = String(url).replace("https://api.hubapi.com", "");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    const key = `${method} ${path.replace(/\/\d+$/, "/:id")}`;
    const handler = responses[key];
    if (!handler) return new Response(JSON.stringify({ message: `no fixture for ${key}` }), { status: 404 });
    const { status, json, headers } = handler(body);
    return new Response(json === undefined ? "" : JSON.stringify(json), { status, headers });
  }) as typeof fetch;
  return { fetcher, calls };
}

function memoryLinks(): CrmLinkRepo & { links: Map<string, { contactId: string | null; dealId: string | null }>; cleared: string[] } {
  const links = new Map<string, { contactId: string | null; dealId: string | null }>();
  const cleared: string[] = [];
  return {
    links,
    cleared,
    getLink: async (id) => links.get(id) ?? null,
    saveLink: async (id, link) => void links.set(id, link),
    clearSyncFlag: async (id) => void cleared.push(id),
  };
}

const enquiry = (overrides: Partial<CrmEnquiry> = {}): CrmEnquiry => ({
  id: "enq-1",
  outcome: "QUALIFIED",
  phone: "+918056203528",
  callerName: "Priya Sharma",
  locality: "Kothrud",
  scope: "3BHK full redesign",
  booked: true,
  result: null,
  ...overrides,
});

describe("stageFor", () => {
  it("follows the enquiry", () => {
    expect(stageFor(enquiry())).toBe("booked");
    expect(stageFor(enquiry({ booked: false }))).toBe("new");
    expect(stageFor(enquiry({ result: "won" }))).toBe("won");
    expect(stageFor(enquiry({ outcome: "NOT_QUALIFIED", booked: false }))).toBeNull();
  });
});

describe("syncEnquiryToCrm", () => {
  it("reuses an existing contact found by phone and creates a booked deal linked to it", async () => {
    const { fetcher, calls } = recordingFetch({
      "POST /crm/v3/objects/contacts/search": () => ({ status: 200, json: { total: 1, results: [{ id: "501" }] } }),
      "GET /crm/v3/pipelines/deals": () => ({ status: 200, json: PIPELINES }),
      "POST /crm/v3/objects/deals": () => ({ status: 201, json: { id: "9001" } }),
    });
    const links = memoryLinks();
    const result = await syncEnquiryToCrm(enquiry(), { client: createHubspotClient("t", fetcher), links, stageLabels: LABELS });
    expect(result).toEqual({ contactId: "501", dealId: "9001", stage: "booked" });
    const deal = calls.find((call) => call.path === "/crm/v3/objects/deals")!.body as { properties: Record<string, string>; associations: unknown[] };
    expect(deal.properties).toMatchObject({ pipeline: "default", dealstage: "appointmentscheduled", dealname: "Priya Sharma - 3BHK full redesign, Kothrud" });
    expect(deal.associations).toEqual([{ to: { id: "501" }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }] }]);
    expect(links.cleared).toEqual(["enq-1"]);
    expect(calls.some((call) => call.path === "/crm/v3/objects/contacts")).toBe(false);
  });

  it("creates a contact when none exists, with no deal for a not-qualified caller", async () => {
    const { fetcher, calls } = recordingFetch({
      "POST /crm/v3/objects/contacts/search": () => ({ status: 200, json: { total: 0, results: [] } }),
      "POST /crm/v3/objects/contacts": () => ({ status: 201, json: { id: "777" } }),
    });
    const result = await syncEnquiryToCrm(enquiry({ outcome: "NOT_QUALIFIED", booked: false }), { client: createHubspotClient("t", fetcher), links: memoryLinks(), stageLabels: LABELS });
    expect(result).toEqual({ contactId: "777", dealId: null, stage: null });
    expect(calls.find((call) => call.path === "/crm/v3/objects/contacts")!.body).toEqual({ properties: { firstname: "Priya", lastname: "Sharma", phone: "+918056203528", city: "Kothrud" } });
  });

  it("moves an existing deal to Closed Won without creating anything new", async () => {
    const { fetcher, calls } = recordingFetch({
      "GET /crm/v3/pipelines/deals": () => ({ status: 200, json: PIPELINES }),
      "PATCH /crm/v3/objects/deals/:id": () => ({ status: 200, json: { id: "9001" } }),
    });
    const links = memoryLinks();
    links.links.set("enq-1", { contactId: "501", dealId: "9001" });
    await syncEnquiryToCrm(enquiry({ result: "won" }), { client: createHubspotClient("t", fetcher), links, stageLabels: LABELS });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(["GET /crm/v3/pipelines/deals", "PATCH /crm/v3/objects/deals/9001"]);
    expect(calls[1].body).toEqual({ properties: { dealstage: "closedwon" } });
  });

  it("retries after a 429 rate limit", async () => {
    let attempts = 0;
    const { fetcher } = recordingFetch({
      "POST /crm/v3/objects/contacts/search": () => {
        attempts += 1;
        return attempts === 1 ? { status: 429, json: { message: "rate limit" }, headers: { "retry-after": "0" } } : { status: 200, json: { results: [{ id: "501" }] } };
      },
    });
    const result = await syncEnquiryToCrm(enquiry({ outcome: "NEEDS_HUMAN", booked: false }), { client: createHubspotClient("t", fetcher), links: memoryLinks(), stageLabels: LABELS });
    expect(attempts).toBe(2);
    expect(result.contactId).toBe("501");
  });

  it("fails clearly when a configured stage label does not exist", async () => {
    const { fetcher } = recordingFetch({
      "POST /crm/v3/objects/contacts/search": () => ({ status: 200, json: { results: [{ id: "501" }] } }),
      "GET /crm/v3/pipelines/deals": () => ({ status: 200, json: PIPELINES }),
    });
    await expect(
      syncEnquiryToCrm(enquiry(), { client: createHubspotClient("t", fetcher), links: memoryLinks(), stageLabels: { ...LABELS, booked: "Meeting Booked" } }),
    ).rejects.toThrow(/Meeting Booked/);
  });
});
