// HubSpot sync: one contact per caller (matched by phone), one deal per booked or qualified
// enquiry, deal stage following the enquiry. Idempotent through crm_links.

const BASE = "https://api.hubapi.com";

export type CrmStageKey = "new" | "booked" | "won" | "lost";

export class HubspotError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HubspotError";
  }
}

export type HubspotClient = {
  findContactByPhone(phone: string): Promise<string | null>;
  createContact(properties: Record<string, string>): Promise<string>;
  createDeal(properties: Record<string, string>, contactId: string): Promise<string>;
  updateDeal(dealId: string, properties: Record<string, string>): Promise<void>;
  dealStages(): Promise<{ pipelineId: string; stages: { id: string; label: string }[] }>;
};

export function createHubspotClient(token: string, fetcher: typeof fetch = fetch): HubspotClient {
  async function call<T>(method: string, path: string, body?: unknown, attempt = 0): Promise<T> {
    const response = await fetcher(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 429 && attempt < 2) {
      const wait = Number(response.headers.get("retry-after") ?? "1");
      await new Promise((resolve) => setTimeout(resolve, Math.min(10, wait) * 1000));
      return call<T>(method, path, body, attempt + 1);
    }
    const text = await response.text();
    if (!response.ok) throw new HubspotError(`HubSpot ${method} ${path} -> ${response.status}: ${text.slice(0, 200)}`, response.status);
    return (text ? JSON.parse(text) : {}) as T;
  }
  return {
    async findContactByPhone(phone) {
      const result = await call<{ results: { id: string }[] }>("POST", "/crm/v3/objects/contacts/search", {
        filterGroups: [{ filters: [{ propertyName: "phone", operator: "EQ", value: phone }] }],
        properties: ["phone"],
        limit: 1,
      });
      return result.results[0]?.id ?? null;
    },
    async createContact(properties) {
      return (await call<{ id: string }>("POST", "/crm/v3/objects/contacts", { properties })).id;
    },
    async createDeal(properties, contactId) {
      const result = await call<{ id: string }>("POST", "/crm/v3/objects/deals", {
        properties,
        associations: [{ to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }] }],
      });
      return result.id;
    },
    async updateDeal(dealId, properties) {
      await call("PATCH", `/crm/v3/objects/deals/${dealId}`, { properties });
    },
    async dealStages() {
      const result = await call<{ results: { id: string; label: string; stages: { id: string; label: string }[] }[] }>("GET", "/crm/v3/pipelines/deals");
      const pipeline = result.results.find((p) => p.id === "default") ?? result.results[0];
      if (!pipeline) throw new HubspotError("No deal pipeline found", 404);
      return { pipelineId: pipeline.id, stages: pipeline.stages.map(({ id, label }) => ({ id, label })) };
    },
  };
}

export type CrmEnquiry = {
  id: string;
  outcome: string;
  phone: string;
  callerName: string | null;
  locality: string | null;
  scope: string | null;
  booked: boolean;
  result: "won" | "lost" | null;
};

export interface CrmLinkRepo {
  getLink(enquiryId: string): Promise<{ contactId: string | null; dealId: string | null } | null>;
  saveLink(enquiryId: string, link: { contactId: string; dealId: string | null }): Promise<void>;
  clearSyncFlag(enquiryId: string): Promise<void>;
}

export function stageFor(enquiry: CrmEnquiry): CrmStageKey | null {
  if (enquiry.result) return enquiry.result;
  if (enquiry.booked) return "booked";
  if (enquiry.outcome === "QUALIFIED" || enquiry.outcome === "QUALIFIED_WITH_NOTES") return "new";
  return null;
}

export async function syncEnquiryToCrm(
  enquiry: CrmEnquiry,
  deps: { client: HubspotClient; links: CrmLinkRepo; stageLabels: Record<CrmStageKey, string>; stageIds?: Map<string, string> },
): Promise<{ contactId: string; dealId: string | null; stage: CrmStageKey | null }> {
  const link = (await deps.links.getLink(enquiry.id)) ?? { contactId: null, dealId: null };
  let contactId = link.contactId ?? (await deps.client.findContactByPhone(enquiry.phone));
  if (!contactId) {
    const [firstname, ...rest] = (enquiry.callerName ?? "Phone enquiry").split(" ");
    contactId = await deps.client.createContact({
      firstname,
      ...(rest.length ? { lastname: rest.join(" ") } : {}),
      phone: enquiry.phone,
      ...(enquiry.locality ? { city: enquiry.locality } : {}),
    });
  }

  const stage = stageFor(enquiry);
  let dealId = link.dealId;
  if (stage) {
    const { pipelineId, stages } = await deps.client.dealStages();
    const stageId = stages.find((s) => s.label.toLowerCase() === deps.stageLabels[stage].toLowerCase())?.id;
    if (!stageId) throw new HubspotError(`Deal stage "${deps.stageLabels[stage]}" not found in pipeline ${pipelineId}`, 404);
    if (!dealId) {
      dealId = await deps.client.createDeal(
        { dealname: `${enquiry.callerName ?? "Phone enquiry"} - ${enquiry.scope ?? "interiors"}${enquiry.locality ? `, ${enquiry.locality}` : ""}`.slice(0, 200), pipeline: pipelineId, dealstage: stageId },
        contactId,
      );
    } else {
      await deps.client.updateDeal(dealId, { dealstage: stageId });
    }
  }
  await deps.links.saveLink(enquiry.id, { contactId, dealId });
  await deps.links.clearSyncFlag(enquiry.id);
  return { contactId, dealId, stage };
}
