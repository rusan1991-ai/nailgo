CREATE TABLE "master_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"master_id" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"telegram" text,
	"max" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"master_id" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "masters" ADD COLUMN "username_slug" text;--> statement-breakpoint
ALTER TABLE "master_clients" ADD CONSTRAINT "master_clients_master_id_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."masters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_master_id_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."masters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "master_clients_master" ON "master_clients" USING btree ("master_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "master_clients_phone" ON "master_clients" USING btree ("master_id","phone");--> statement-breakpoint
CREATE INDEX "time_blocks_master_start" ON "time_blocks" USING btree ("master_id","start_at");--> statement-breakpoint
ALTER TABLE "masters" ADD CONSTRAINT "masters_username_slug_unique" UNIQUE("username_slug");