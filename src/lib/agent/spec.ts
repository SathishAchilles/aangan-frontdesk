// The voice agent's greeting and tools, defined once. scripts/vaani-sync.ts turns these into
// Vaani cURL tools; the agent simulation turns them into model function declarations.

export const GREETING =
  "Hello, thank you for calling Aangan Studio. I'm the studio's AI assistant, and this call is recorded. How can I help you today?";

export const GOODBYE = "Thank you for calling Aangan Studio. Have a lovely day.";

type JsonSchema = {
  type: "object";
  properties: Record<string, { type: string; description: string; enum?: string[]; items?: { type: string } }>;
  required?: string[];
};

export type ToolSpec = {
  name: string;
  path?: string; // our endpoint under /api/vaani/tools; absent for Vaani built-ins
  description: string;
  parameters: JsonSchema;
};

const FACT_PROPERTIES: JsonSchema["properties"] = {
  project_type: { type: "string", enum: ["residential", "commercial", "unknown"], description: "Home or business space." },
  property_kind: { type: "string", enum: ["apartment", "villa", "independent_house", "office", "other"], description: "Kind of property." },
  segment: { type: "string", description: "For businesses only, e.g. restaurant, cafe, shop, gym, clinic, office." },
  work_type: {
    type: "string",
    enum: ["design_execution", "advice_only", "decor_only", "furniture_only", "vastu_only", "structural"],
    description: "Only when clearly stated.",
  },
  execution: { type: "string", enum: ["yes", "no", "unknown"], description: "Do they want design AND execution?" },
  scope_text: { type: "string", description: "What they want done, in their words." },
  rooms: { type: "array", items: { type: "string" }, description: "Rooms named, e.g. kitchen, bedroom." },
  full_home: { type: "boolean", description: "True if the whole home is to be done." },
  sqft: { type: "number", description: "Carpet area in square feet, if said." },
  locality: { type: "string", description: "Area or society they named." },
  deadline_text: { type: "string", description: "When it must be done or when they want to start, in their words." },
  budget_text: { type: "string", description: "Only if the caller volunteered a budget. Never ask." },
  decision_text: { type: "string", description: "What they said about who decides." },
  wants_human: { type: "boolean", description: "True if they asked for a person." },
  wants_site_visit: { type: "boolean", description: "True if they asked for someone to visit the site." },
  referral_text: { type: "string", description: "Who referred them, if mentioned." },
  frustrated: { type: "boolean", description: "True if upset about the studio." },
};

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: "lookup_caller",
    path: "lookup-caller",
    description: "Call silently right after the greeting. Returns the current time in IST, whether the office is open, and any recent enquiry from this number.",
    parameters: { type: "object", properties: { phone: { type: "string", description: "Caller's number, if known." } } },
  },
  {
    name: "evaluate_enquiry",
    path: "evaluate-enquiry",
    description:
      "Call after the caller says anything new about their project. Returns outcome and the exact sentence to say next (next_question or say_line). Send all facts known so far.",
    parameters: {
      type: "object",
      properties: {
        enquiry_id: { type: "string", description: "From lookup_caller or an earlier evaluate_enquiry result." },
        phone: { type: "string", description: "Caller's phone number." },
        intent: { type: "string", enum: ["new", "existing", "other"], description: "new project, existing client, or other." },
        asked: { type: "array", items: { type: "string" }, description: "Criteria whose question you already asked: C1, C2, C3." },
        ...FACT_PROPERTIES,
      },
      required: ["phone"],
    },
  },
  {
    name: "get_slots",
    path: "get-slots",
    description: "Only after evaluate_enquiry returned QUALIFIED or QUALIFIED_WITH_NOTES. Returns two or three consultation times to offer.",
    parameters: {
      type: "object",
      properties: {
        enquiry_id: { type: "string", description: "The enquiry id." },
        consult_type: { type: "string", enum: ["studio", "site", "principal"], description: "From the evaluate_enquiry result." },
        constraints_text: { type: "string", description: "The caller's own words about when they are free." },
      },
      required: ["enquiry_id"],
    },
  },
  {
    name: "book_slot",
    path: "book-slot",
    description: "Book the time the caller chose. Use the slot id from get_slots.",
    parameters: {
      type: "object",
      properties: {
        enquiry_id: { type: "string", description: "The enquiry id." },
        slot_id: { type: "string", description: "The id of the chosen slot." },
        name: { type: "string", description: "Caller's name." },
        phone: { type: "string", description: "Caller's phone number." },
        address: { type: "string", description: "Site address, for a site visit." },
      },
      required: ["enquiry_id", "slot_id", "name", "phone"],
    },
  },
  {
    name: "log_intent",
    path: "log-intent",
    description: "For an existing client with a problem (existing_client) or someone not enquiring about a project (message).",
    parameters: {
      type: "object",
      properties: {
        phone: { type: "string", description: "Caller's number." },
        intent: { type: "string", enum: ["existing_client", "message"], description: "Which kind of call." },
        summary: { type: "string", description: "One-line summary of what they need." },
      },
      required: ["intent", "summary"],
    },
  },
  {
    name: "transfer_call",
    description: "Transfer to the front desk. Only when the caller asks for a person and the office is open.",
    parameters: { type: "object", properties: { reason: { type: "string", description: "Why the caller is being transferred." } } },
  },
  {
    name: "end_call",
    description: "End the call, only after your goodbye has been spoken.",
    parameters: { type: "object", properties: {} },
  },
];
