CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"audience" text NOT NULL,
	"phone" text,
	"user_id" text,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"booking_id" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "notifications_phone_created" ON "notifications" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_created" ON "notifications" USING btree ("user_id","created_at");