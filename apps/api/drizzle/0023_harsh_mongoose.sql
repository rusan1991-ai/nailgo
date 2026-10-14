CREATE TABLE "promotion_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_key" text NOT NULL,
	"master_id" text NOT NULL,
	"event_type" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "promotion_events" ADD CONSTRAINT "promotion_events_master_id_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."masters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_events_event_key" ON "promotion_events" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "promotion_events_master_created" ON "promotion_events" USING btree ("master_id","created_at");--> statement-breakpoint
CREATE INDEX "promotion_events_master_type_created" ON "promotion_events" USING btree ("master_id","event_type","created_at");