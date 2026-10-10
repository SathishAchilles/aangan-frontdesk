ALTER TABLE "aangan"."calls" ADD COLUMN "callback_placed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "aangan"."enquiries" ADD COLUMN "outcome_nudges" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "aangan"."enquiries" ADD COLUMN "last_nudge_at" timestamp with time zone;