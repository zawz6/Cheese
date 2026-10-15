CREATE TABLE "entry_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone NOT NULL,
	"rating_half" smallint,
	"review" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_run_rating_range" CHECK ("entry_run"."rating_half" is null or "entry_run"."rating_half" between 1 and 10)
);
--> statement-breakpoint
ALTER TABLE "entry_run" ADD CONSTRAINT "entry_run_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entry_run_entry_idx" ON "entry_run" USING btree ("entry_id","finished_at");