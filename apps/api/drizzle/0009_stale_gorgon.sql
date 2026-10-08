CREATE TABLE "favorites" (
	"id" text PRIMARY KEY NOT NULL,
	"client_phone" text NOT NULL,
	"master_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_master_id_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."masters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "favorites_client_master" ON "favorites" USING btree ("client_phone","master_id");--> statement-breakpoint
CREATE INDEX "favorites_master" ON "favorites" USING btree ("master_id");