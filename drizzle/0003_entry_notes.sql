CREATE TABLE "entry_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_note_body" CHECK (char_length("entry_note"."body") between 1 and 280),
	CONSTRAINT "entry_note_position" CHECK ("entry_note"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "entry_note" ADD CONSTRAINT "entry_note_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_note" ADD CONSTRAINT "entry_note_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_note" ADD CONSTRAINT "entry_note_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entry_note_item_idx" ON "entry_note" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE INDEX "entry_note_entry_idx" ON "entry_note" USING btree ("entry_id");