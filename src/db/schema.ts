import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Tables live outside `public`, which Supabase publishes through its REST API, and have RLS on
// with no policies: only the server's `aangan_app` role can use them. Integration tests and
// evals point DB_SCHEMA at `aangan_test`, which gets the same tables.
export const SCHEMA_NAME = process.env.DB_SCHEMA === "aangan_test" ? "aangan_test" : "aangan";
export const aangan = pgSchema(SCHEMA_NAME);

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();

export const OUTCOME_VALUES = [
  "PENDING",
  "QUALIFIED",
  "QUALIFIED_WITH_NOTES",
  "NOT_QUALIFIED",
  "NEEDS_HUMAN",
  "NOT_ENQUIRY",
] as const;
export const STAFF_ROLES = ["admin", "viewer", "designer", "front_desk"] as const;
export const CONSULT_TYPES = ["studio", "site", "principal"] as const;
export const TASK_KINDS = ["callback", "rebook", "review", "nurture", "urgent", "message", "alert"] as const;
export const COST_KINDS = ["telephony_min", "agent_min", "ai_in_tok", "ai_out_tok"] as const;

const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map((value) => `'${value}'`).join(", ")})`);

export const staff = aangan
  .table(
    "staff",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      authUserId: uuid("auth_user_id").unique(),
      name: text("name").notNull(),
      email: text("email"),
      role: text("role").$type<(typeof STAFF_ROLES)[number]>().notNull(),
      telegramUserId: bigint("telegram_user_id", { mode: "number" }),
      calcomUserId: integer("calcom_user_id"),
      consultTypes: text("consult_types").array().notNull().default(sql`'{}'::text[]`),
      active: boolean("active").notNull().default(true),
      createdAt: createdAt(),
    },
    () => [check("staff_role_check", inList("role", STAFF_ROLES))],
  )
  .enableRLS();

export const callers = aangan
  .table("callers", {
    id: uuid("id").primaryKey().defaultRandom(),
    phoneE164: text("phone_e164").notNull().unique(),
    name: text("name"),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  })
  .enableRLS();

export const enquiries = aangan
  .table(
    "enquiries",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      callerId: uuid("caller_id")
        .notNull()
        .references(() => callers.id),
      channel: text("channel").notNull().default("phone"),
      intent: text("intent").notNull().default("new"),
      outcome: text("outcome").$type<(typeof OUTCOME_VALUES)[number]>().notNull().default("PENDING"),
      criteria: jsonb("criteria").notNull().default({}),
      flags: text("flags").array().notNull().default(sql`'{}'::text[]`),
      facts: jsonb("facts").notNull().default({}),
      asked: text("asked").array().notNull().default(sql`'{}'::text[]`),
      consultType: text("consult_type").$type<(typeof CONSULT_TYPES)[number]>(),
      assignedDesignerId: uuid("assigned_designer_id").references(() => staff.id),
      nurtureDueAt: ts("nurture_due_at"),
      consultResult: text("consult_result").$type<"won" | "lost">(),
      consultResultAt: ts("consult_result_at"),
      settingsVersion: integer("settings_version"),
      createdAt: createdAt(),
      updatedAt: ts("updated_at").notNull().defaultNow(),
    },
    (t) => [
      check("enquiries_outcome_check", inList("outcome", OUTCOME_VALUES)),
      check("enquiries_intent_check", inList("intent", ["new", "existing", "other"])),
      index("enquiries_caller_idx").on(t.callerId),
      index("enquiries_created_idx").on(t.createdAt),
    ],
  )
  .enableRLS();

export const calls = aangan
  .table(
    "calls",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      vaaniCallId: text("vaani_call_id").notNull().unique(),
      enquiryId: uuid("enquiry_id").references(() => enquiries.id),
      callerId: uuid("caller_id").references(() => callers.id),
      direction: text("direction").$type<"in" | "out">().notNull().default("in"),
      startedAt: ts("started_at"),
      endedAt: ts("ended_at"),
      durationS: integer("duration_s"),
      transcript: text("transcript"),
      recordingUrl: text("recording_url"),
      summary: text("summary"),
      endReason: text("end_reason"),
      dropped: boolean("dropped").notNull().default(false),
      callbackOfCallId: uuid("callback_of_call_id"),
      promptVersion: text("prompt_version"),
      graderFlags: jsonb("grader_flags").notNull().default({}),
      createdAt: createdAt(),
    },
    (t) => [index("calls_enquiry_idx").on(t.enquiryId), index("calls_started_idx").on(t.startedAt)],
  )
  .enableRLS();

export const bookings = aangan
  .table(
    "bookings",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      enquiryId: uuid("enquiry_id")
        .notNull()
        .references(() => enquiries.id),
      calcomUid: text("calcom_uid").notNull().unique(),
      consultType: text("consult_type").$type<(typeof CONSULT_TYPES)[number]>().notNull(),
      startAt: ts("start_at").notNull(),
      endAt: ts("end_at"),
      designerId: uuid("designer_id").references(() => staff.id),
      status: text("status").$type<"booked" | "rescheduled" | "cancelled">().notNull().default("booked"),
      createdAt: createdAt(),
      updatedAt: ts("updated_at").notNull().defaultNow(),
    },
    (t) => [index("bookings_enquiry_idx").on(t.enquiryId)],
  )
  .enableRLS();

export const handoffs = aangan
  .table("handoffs", {
    id: uuid("id").primaryKey().defaultRandom(),
    enquiryId: uuid("enquiry_id")
      .notNull()
      .unique()
      .references(() => enquiries.id),
    chatId: bigint("chat_id", { mode: "number" }),
    messageId: integer("message_id"),
    note: jsonb("note"),
    postedAt: ts("posted_at"),
    acceptedBy: uuid("accepted_by").references(() => staff.id),
    acceptedAt: ts("accepted_at"),
    remindedAt: ts("reminded_at"),
    escalatedAt: ts("escalated_at"),
  })
  .enableRLS();

export const tasks = aangan
  .table(
    "tasks",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      enquiryId: uuid("enquiry_id").references(() => enquiries.id),
      kind: text("kind").$type<(typeof TASK_KINDS)[number]>().notNull(),
      reason: text("reason"),
      payload: jsonb("payload").notNull().default({}),
      dueAt: ts("due_at"),
      chatId: bigint("chat_id", { mode: "number" }),
      messageId: integer("message_id"),
      doneAt: ts("done_at"),
      doneBy: uuid("done_by").references(() => staff.id),
      escalatedAt: ts("escalated_at"),
      createdAt: createdAt(),
    },
    (t) => [
      check("tasks_kind_check", inList("kind", TASK_KINDS)),
      index("tasks_open_due_idx").on(t.dueAt).where(sql`done_at is null`),
    ],
  )
  .enableRLS();

export const inbox = aangan
  .table(
    "inbox",
    {
      id: bigserial("id", { mode: "number" }).primaryKey(),
      source: text("source").$type<"vaani" | "calcom" | "telegram">().notNull(),
      externalId: text("external_id").notNull(),
      payload: jsonb("payload").notNull(),
      receivedAt: ts("received_at").notNull().defaultNow(),
      processedAt: ts("processed_at"),
      attempts: integer("attempts").notNull().default(0),
      lastError: text("last_error"),
    },
    (t) => [
      uniqueIndex("inbox_source_external_uq").on(t.source, t.externalId),
      index("inbox_unprocessed_idx").on(t.receivedAt).where(sql`processed_at is null`),
    ],
  )
  .enableRLS();

export const costLines = aangan
  .table(
    "cost_lines",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      callId: uuid("call_id").references(() => calls.id),
      enquiryId: uuid("enquiry_id").references(() => enquiries.id),
      kind: text("kind").$type<(typeof COST_KINDS)[number]>().notNull(),
      qty: numeric("qty", { mode: "number" }).notNull(),
      unitPriceInr: numeric("unit_price_inr", { mode: "number" }).notNull(),
      amountInr: numeric("amount_inr", { mode: "number" }).notNull(),
      recordedAt: ts("recorded_at").notNull().defaultNow(),
    },
    (t) => [check("cost_lines_kind_check", inList("kind", COST_KINDS)), index("cost_lines_recorded_idx").on(t.recordedAt)],
  )
  .enableRLS();

export const fixedCosts = aangan
  .table(
    "fixed_costs",
    {
      month: date("month").notNull(),
      item: text("item").notNull(),
      amountInr: numeric("amount_inr", { mode: "number" }).notNull(),
    },
    (t) => [primaryKey({ columns: [t.month, t.item] })],
  )
  .enableRLS();

export const crmLinks = aangan
  .table("crm_links", {
    enquiryId: uuid("enquiry_id")
      .primaryKey()
      .references(() => enquiries.id),
    hubspotContactId: text("hubspot_contact_id"),
    hubspotDealId: text("hubspot_deal_id"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  })
  .enableRLS();

export const settings = aangan
  .table("settings", {
    key: text("key").primaryKey(),
    value: jsonb("value").notNull(),
    defaultValue: jsonb("default_value").notNull(),
    type: text("type").notNull(),
    min: numeric("min", { mode: "number" }),
    max: numeric("max", { mode: "number" }),
    sourceNote: text("source_note").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => staff.id),
  })
  .enableRLS();

export const settingsAudit = aangan
  .table("settings_audit", {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value").notNull(),
    reason: text("reason").notNull(),
    actorId: uuid("actor_id").references(() => staff.id),
    at: ts("at").notNull().defaultNow(),
  })
  .enableRLS();

export const settingsVersions = aangan
  .table("settings_versions", {
    id: serial("id").primaryKey(),
    snapshot: jsonb("snapshot").notNull(),
    createdAt: createdAt(),
    createdBy: uuid("created_by").references(() => staff.id),
  })
  .enableRLS();

export const localities = aangan
  .table(
    "localities",
    {
      name: text("name").primaryKey(),
      aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
      status: text("status").$type<"in" | "out">().notNull(),
      note: text("note"),
    },
    () => [check("localities_status_check", inList("status", ["in", "out"]))],
  )
  .enableRLS();

export const festivalDates = aangan
  .table(
    "festival_dates",
    {
      name: text("name").notNull(),
      year: integer("year").notNull(),
      date: date("date").notNull(),
    },
    (t) => [primaryKey({ columns: [t.name, t.year] })],
  )
  .enableRLS();

export const evalRuns = aangan
  .table(
    "eval_runs",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      evalName: text("eval_name").notNull(),
      datasetVersion: text("dataset_version").notNull(),
      commitSha: text("commit_sha").notNull(),
      promptVersion: text("prompt_version"),
      settingsVersion: integer("settings_version"),
      startedAt: ts("started_at").notNull(),
      finishedAt: ts("finished_at").notNull(),
      metrics: jsonb("metrics").notNull(),
      thresholds: jsonb("thresholds").notNull(),
      failedThresholds: text("failed_thresholds").array().notNull().default(sql`'{}'::text[]`),
      passed: boolean("passed").notNull(),
      costInr: numeric("cost_inr", { mode: "number" }).notNull().default(0),
    },
    (t) => [index("eval_runs_name_started_idx").on(t.evalName, t.startedAt)],
  )
  .enableRLS();

export const evalItems = aangan
  .table(
    "eval_items",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      runId: uuid("run_id")
        .notNull()
        .references(() => evalRuns.id, { onDelete: "cascade" }),
      itemId: text("item_id").notNull(),
      expected: jsonb("expected"),
      actual: jsonb("actual"),
      scores: jsonb("scores").notNull().default({}),
      passed: boolean("passed").notNull(),
      transcriptRef: text("transcript_ref"),
    },
    (t) => [index("eval_items_run_idx").on(t.runId)],
  )
  .enableRLS();
