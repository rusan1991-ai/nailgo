CREATE TABLE "deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"kind" text NOT NULL,
	"recipient" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"booking_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider" text,
	"provider_id" text,
	"error" text,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "deliveries_queue" ON "deliveries" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "deliveries_recipient" ON "deliveries" USING btree ("recipient","created_at");--> statement-breakpoint
CREATE INDEX "deliveries_booking" ON "deliveries" USING btree ("booking_id");