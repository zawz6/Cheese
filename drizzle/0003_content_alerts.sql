ALTER TABLE "item" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "alerts_enabled" boolean DEFAULT true NOT NULL;