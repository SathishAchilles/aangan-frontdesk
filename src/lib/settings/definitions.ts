// Every admin-editable setting: default, type, allowed range and where the value comes from.
// The seed writes these rows; the Settings page edits `value` only. Price quoting is not a
// setting and never will be (pricing.md): floors below are used only by the budget check.

export type SettingType = "int" | "number" | "string" | "enum" | "json";

export type SettingDefinition = {
  key: string;
  type: SettingType;
  default: unknown;
  min?: number;
  max?: number;
  options?: readonly string[];
  source: string;
};

export const UNCLEAR_ACTIONS = ["qualified_with_notes", "needs_human"] as const;
export const SMALL_COMMERCIAL_ACTIONS = ["needs_human", "decline", "off"] as const;

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  // Follow-ups
  { key: "accept_reminder_min", type: "int", default: 15, min: 5, max: 240, source: "Designers are often on site; first reminder after 15 office minutes." },
  { key: "accept_escalate_min", type: "int", default: 30, min: 5, max: 480, source: "Case brief: answered within 1 hour converts 4x; escalate at 30 to stay inside the hour." },
  { key: "office_hours", type: "json", default: { start: "10:00", end: "19:00" }, source: "Case brief: front desk covers 10am to 7pm." },
  { key: "office_days", type: "json", default: ["mon", "tue", "wed", "thu", "fri"], source: "Transcript W05: 'we're closed over the weekend'." },
  { key: "callback_within_min", type: "int", default: 30, min: 5, max: 240, source: "Promised callback time during office hours." },
  { key: "after_hours_callback_time", type: "string", default: "10:30", source: "Callback promised for the next working day when the office is closed." },
  { key: "outcome_nudge_max", type: "int", default: 3, min: 1, max: 10, source: "Follow-ups spec: nudge for Won/Lost up to 3 times." },
  { key: "nurture_after_weeks", type: "int", default: 6, min: 1, max: 26, source: "Follow-ups spec: timeline-only fails get a reminder after 6 weeks." },
  { key: "dropped_call_callback_min", type: "int", default: 5, min: 1, max: 60, source: "Call-handling spec: call back dropped enquiries within 5 minutes." },
  { key: "merge_window_minutes", type: "int", default: 60, min: 5, max: 1440, source: "Lead-handoff spec: calls from one number within the window are one enquiry." },

  // Qualification
  { key: "timeline_hard_fail_weeks", type: "int", default: 6, min: 2, max: 16, source: "services.md line 45: cannot begin execution if ready in under 6 weeks." },
  { key: "timeline_tight_weeks", type: "int", default: 12, min: 4, max: 26, source: "services.md lines 43-44: design 3-4 weeks plus execution 8+ weeks." },
  { key: "budget_clearly_below_pct", type: "int", default: 50, min: 20, max: 90, source: "qualified.md lines 19, 43: separates the rubric's own fail example (~10%) and T10 (21%) from real leads (F03 79%)." },
  {
    key: "budget_floors",
    type: "json",
    default: { residential_per_sqft: 1800, single_room: 350000, commercial_per_sqft: 1200 },
    source: "pricing.md lines 9, 15, 21 (lowest indicative figures). Used only inside the budget check; never spoken.",
  },
  { key: "commercial_max_sqft", type: "int", default: 3000, min: 500, max: 20000, source: "services.md lines 17, 38: offices up to ~3,000 sq ft." },
  { key: "commercial_min_sqft", type: "int", default: 500, min: 0, max: 3000, source: "Transcript T18 (front desk practice); not written in services.md." },
  { key: "commercial_below_min_action", type: "enum", default: "needs_human", options: SMALL_COMMERCIAL_ACTIONS, source: "Unwritten rule, so a person decides until the founder writes it down." },
  {
    key: "unclear_after_question",
    type: "json",
    default: { C1: "qualified_with_notes", C2: "needs_human", C3: "qualified_with_notes" },
    source: "qualified.md line 43: the designer establishes fit at the consultation; area cannot be settled there.",
  },
  { key: "principal_visit_min_sqft", type: "int", default: 3000, min: 1000, max: 20000, source: "Booking spec: villas or projects over 3,000 sq ft get a principal-designer visit (T12)." },
  { key: "slot_horizon_working_days", type: "int", default: 10, min: 3, max: 30, source: "Booking spec: offer slots within 10 working days." },

  // Integrations (filled by setup scripts)
  { key: "telegram_chats", type: "json", default: { designers: null, front_desk: null, founder: null }, source: "Set by scripts/telegram-setup.ts." },
  { key: "calcom_event_types", type: "json", default: { studio: null, site: null, principal: null }, source: "Set when the Cal.com event types are created." },
  {
    key: "hubspot_stages",
    type: "json",
    default: { new: "New Qualified Enquiry", booked: "Meeting Booked", won: "Won", lost: "Lost" },
    source: "HubSpot deal pipeline stage labels.",
  },

  // Costs (copied onto each cost line when recorded)
  { key: "cost_agent_inr_per_min", type: "number", default: 4.92, min: 0, max: 100, source: "Vaani per-minute estimate from the as-built README; confirm on the Vaani billing page." },
  { key: "cost_telephony_inr_per_min", type: "number", default: 0, min: 0, max: 100, source: "Vaani-provisioned number; set when the Vobiz rate is known." },
  { key: "cost_ai_usd_per_m", type: "json", default: { input: 0.3, output: 2.5 }, source: "Gemini 2.5 Flash list price; check ai.google.dev/gemini-api/docs/pricing." },
  { key: "inr_per_usd", type: "number", default: 88, min: 50, max: 150, source: "Conversion rate for AI token costs." },

  // Privacy
  { key: "retention_recording_days", type: "int", default: 90, min: 7, max: 730, source: "Privacy: recordings links kept 90 days." },
  { key: "retention_transcript_days", type: "int", default: 365, min: 30, max: 1095, source: "Privacy: transcripts kept 12 months." },
];

export const SETTING_KEYS = SETTING_DEFINITIONS.map((definition) => definition.key);
