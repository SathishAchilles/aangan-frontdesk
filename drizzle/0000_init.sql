-- Schema "aangan" is created once by the project admin (see docs/database.md); aangan_app cannot create schemas.
CREATE TABLE "aangan"."bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enquiry_id" uuid NOT NULL,
	"calcom_uid" text NOT NULL,
	"consult_type" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"designer_id" uuid,
	"status" text DEFAULT 'booked' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_calcom_uid_unique" UNIQUE("calcom_uid")
);
--> statement-breakpoint
ALTER TABLE "aangan"."bookings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aangan"."callers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_e164" text NOT NULL,
	"name" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "callers_phone_e164_unique" UNIQUE("phone_e164")
);
--> statement-breakpoint
ALTER TABLE "aangan"."callers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aangan"."calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vaani_call_id" text NOT NULL,
	"enquiry_id" uuid,
	"caller_id" uuid,
	"direction" text DEFAULT 'in' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_s" integer,
	"transcript" text,
	"recording_url" text,
	"summary" text,
	"end_reason" text,
	"dropped" boolean DEFAULT false NOT NULL,
	"callback_of_call_id" uuid,
	"prompt_version" text,
	"grader_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calls_vaani_call_id_unique" UNIQUE("vaani_call_id")
);
--> statement-breakpoint
ALTER TABLE "aangan"."calls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aangan"."cost_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid,
	"enquiry_id" uuid,
	"kind" text NOT NULL,
	"qty" numeric NOT NULL,
	"unit_price_inr" numeric NOT NULL,
	"amount_inr" numeric NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_lines_kind_check" CHECK (kind in ('telephony_min', 'agent_min', 'ai_in_tok', 'ai_out_tok'))
);
--> statement-breakpoint
ALTER TABLE "aangan"."cost_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aangan"."crm_links" (
	"enquiry_id" uuid PRIMARY KEY NOT NULL,
	"hubspot_contact_id" text,
	"hubspot_deal_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aangan"."crm_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aangan"."enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caller_id" uuid NOT NULL,
	"channel" text DEFAULT 'phone' NOT NULL,
	"intent" text DEFAULT 'new' NOT NULL,
	"outcome" text DEFAULT 'PENDING' NOT NULL,
	"criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"asked" text[] DEFAULT '{}'::text[] NOT NULL,
	"consult_type" text,
	"assigned_designer_id" uuid,
	"nurture_due_at" timestamp with time zone,
	"consult_result" text,
	"consult_result_at" timestamp with time zone,
	"settings_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enquiries_outcome_check" CHECK (outcome in ('PENDING', 'QUALIFIED', 'QUALIFIED_WITH_NOTES', 'NOT_QUALIFIED', 'NEEDS_HUMAN', 'NOT_ENQUIRY')),
	CONSTRAINT "enquiries_intent_check" CHECK (intent in ('new', 'existing', 'other'))
);
--> statement-breakpoint
ALTER TABLE "aangan"."enquiries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aangan"."eval_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"expected" jsonb,
	"actual" jsonb,
	"scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"passed" boolean NOT NULL,
	"transcript_ref" text
);
--> statement-breakpoint
ALTER TABLE "aangan"."eval_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aangan"."eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"eval_name" text NOT NULL,
	"dataset_version" text NOT NULL,
	"commit_sha" text NOT NULL,
	"prompt_version" text,
	"settings_version" integer,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"metrics" jsonb NOT NULL,
	"thresholds" jsonb NOT NULL,
	"failed_thresholds" text[] DEFAULT '{}'::text[] NOT NULL,
	"passed" boolean NOT NULL,
	"cost_inr" numeric DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aangan"."eval_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aangan"."festival_dates" (
	"name" text NOT NULL,
	"year" integer NOT NULL,
	"date" date NOT NULL,
	CONSTRAINT "festival_dates_name_year_pk" PRIMARY KEY("name","year")
);
--> statement-breakpoint
ALTER TABLE "aangan"."festival_dates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aangan"."fixed_costs" (
	"month" date NOT NULL,
	"item" text NOT NULL,
	"amount_inr" numeric NOT NULL,
	CONSTRAINT "fixed_costs_month_item_pk" PRIMARY KEY("month","item")
);
--> statement-breakpoint
ALTER TABLE "aangan"."fixed_costs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aangan"."handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enquiry_id" uuid NOT NULL,
	"chat_id" bigint,
	"message_id" integer,
	"posted_at" timestamp with time zone,
	"accepted_by" uuid,
	"accepted_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	CONSTRAINT "handoffs_enquiry_id_unique" UNIQUE("enquiry_id")
);
--> statement-breakpoint
ALTER TABLE "aangan"."handoffs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aangan"."inbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "aangan"."inbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aangan"."localities" (
	"name" text PRIMARY KEY NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text NOT NULL,
	"note" text,
	CONSTRAINT "localities_status_check" CHECK (status in ('in', 'out'))
);
--> statement-breakpoint
ALTER TABLE "aangan"."localities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aangan"."settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"default_value" jsonb NOT NULL,
	"type" text NOT NULL,
	"min" numeric,
	"max" numeric,
	"source_note" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "aangan"."settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aangan"."settings_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb NOT NULL,
	"reason" text NOT NULL,
	"actor_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aangan"."settings_audit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aangan"."settings_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "aangan"."settings_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aangan"."staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" uuid,
	"name" text NOT NULL,
	"email" text,
	"role" text NOT NULL,
	"telegram_user_id" bigint,
	"calcom_user_id" integer,
	"consult_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_auth_user_id_unique" UNIQUE("auth_user_id"),
	CONSTRAINT "staff_role_check" CHECK (role in ('admin', 'viewer', 'designer', 'front_desk'))
);
--> statement-breakpoint
ALTER TABLE "aangan"."staff" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aangan"."tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enquiry_id" uuid,
	"kind" text NOT NULL,
	"reason" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"due_at" timestamp with time zone,
	"chat_id" bigint,
	"message_id" integer,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"escalated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_kind_check" CHECK (kind in ('callback', 'rebook', 'review', 'nurture', 'urgent', 'message', 'alert'))
);
--> statement-breakpoint
ALTER TABLE "aangan"."tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "aangan"."bookings" ADD CONSTRAINT "bookings_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "aangan"."enquiries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aangan"."bookings" ADD CONSTRAINT "bookings_designer_id_staff_id_fk" FOREIGN KEY ("designer_id") REFERENCES "aangan"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aangan"."calls" ADD CONSTRAINT "calls_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "aangan"."enquiries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aangan"."calls" ADD CONSTRAINT "calls_caller_id_callers_id_fk" FOREIGN KEY ("caller_id") REFERENCES "aangan"."callers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aangan"."cost_lines" ADD CONSTRAINT "cost_lines_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "aangan"."calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aangan"."cost_lines" ADD CONSTRAINT "cost_lines_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "aangan"."enquiries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aangan"."crm_links" ADD CONSTRAINT "crm_links_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "aangan"."enquiries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aangan"."enquiries" ADD CONSTRAINT "enquiries_caller_id_callers_id_fk" FOREIGN KEY ("caller_id") REFERENCES "aangan"."callers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aangan"."enquiries" ADD CONSTRAINT "enquiries_assigned_designer_id_staff_id_fk" FOREIGN KEY ("assigned_designer_id") REFERENCES "aangan"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aangan"."eval_items" ADD CONSTRAINT "eval_items_run_id_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "aangan"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aangan"."handoffs" ADD CONSTRAINT "handoffs_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "aangan"."enquiries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aangan"."handoffs" ADD CONSTRAINT "handoffs_accepted_by_staff_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "aangan"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aangan"."settings" ADD CONSTRAINT "settings_updated_by_staff_id_fk" FOREIGN KEY ("updated_by") REFERENCES "aangan"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aangan"."settings_audit" ADD CONSTRAINT "settings_audit_actor_id_staff_id_fk" FOREIGN KEY ("actor_id") REFERENCES "aangan"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aangan"."settings_versions" ADD CONSTRAINT "settings_versions_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "aangan"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aangan"."tasks" ADD CONSTRAINT "tasks_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "aangan"."enquiries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aangan"."tasks" ADD CONSTRAINT "tasks_done_by_staff_id_fk" FOREIGN KEY ("done_by") REFERENCES "aangan"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_enquiry_idx" ON "aangan"."bookings" USING btree ("enquiry_id");--> statement-breakpoint
CREATE INDEX "calls_enquiry_idx" ON "aangan"."calls" USING btree ("enquiry_id");--> statement-breakpoint
CREATE INDEX "calls_started_idx" ON "aangan"."calls" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "cost_lines_recorded_idx" ON "aangan"."cost_lines" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "enquiries_caller_idx" ON "aangan"."enquiries" USING btree ("caller_id");--> statement-breakpoint
CREATE INDEX "enquiries_created_idx" ON "aangan"."enquiries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "eval_items_run_idx" ON "aangan"."eval_items" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "eval_runs_name_started_idx" ON "aangan"."eval_runs" USING btree ("eval_name","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_source_external_uq" ON "aangan"."inbox" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "inbox_unprocessed_idx" ON "aangan"."inbox" USING btree ("received_at") WHERE processed_at is null;--> statement-breakpoint
CREATE INDEX "tasks_open_due_idx" ON "aangan"."tasks" USING btree ("due_at") WHERE done_at is null;