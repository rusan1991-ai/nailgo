CREATE TABLE "salon_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"salon_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"invited_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salon_network_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"network_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salon_networks" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salon_workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"salon_id" text NOT NULL,
	"master_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'chair' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salons" (
	"id" text PRIMARY KEY NOT NULL,
	"network_id" text,
	"owner_user_id" text,
	"name" text NOT NULL,
	"location_id" text,
	"timezone" text DEFAULT 'Europe/Moscow' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "salon_memberships" ADD CONSTRAINT "salon_memberships_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon_memberships" ADD CONSTRAINT "salon_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon_memberships" ADD CONSTRAINT "salon_memberships_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon_network_memberships" ADD CONSTRAINT "salon_network_memberships_network_id_salon_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."salon_networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon_network_memberships" ADD CONSTRAINT "salon_network_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon_networks" ADD CONSTRAINT "salon_networks_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon_workspaces" ADD CONSTRAINT "salon_workspaces_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon_workspaces" ADD CONSTRAINT "salon_workspaces_master_id_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."masters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salons" ADD CONSTRAINT "salons_network_id_salon_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."salon_networks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salons" ADD CONSTRAINT "salons_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salons" ADD CONSTRAINT "salons_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "salon_memberships_salon_user" ON "salon_memberships" USING btree ("salon_id","user_id");--> statement-breakpoint
CREATE INDEX "salon_memberships_user" ON "salon_memberships" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "salon_network_memberships_network_user" ON "salon_network_memberships" USING btree ("network_id","user_id");--> statement-breakpoint
CREATE INDEX "salon_network_memberships_user" ON "salon_network_memberships" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "salon_networks_owner" ON "salon_networks" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "salon_workspaces_salon_master" ON "salon_workspaces" USING btree ("salon_id","master_id");--> statement-breakpoint
CREATE INDEX "salon_workspaces_master" ON "salon_workspaces" USING btree ("master_id","active");--> statement-breakpoint
CREATE INDEX "salons_network" ON "salons" USING btree ("network_id");--> statement-breakpoint
CREATE INDEX "salons_owner" ON "salons" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "salons_location" ON "salons" USING btree ("location_id");--> statement-breakpoint
ALTER TABLE "masters" ADD CONSTRAINT "masters_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Preserve the existing one-master/one-location behavior as a private default branch.
INSERT INTO "salons" ("id", "name", "owner_user_id", "location_id", "timezone", "active")
SELECT 'legacy-salon-' || m."id", m."name" || ' — основное место',
       CASE WHEN EXISTS (SELECT 1 FROM "users" u WHERE u."id" = m."user_id") THEN m."user_id" ELSE NULL END,
       m."location_id", m."timezone", true
FROM "masters" m;--> statement-breakpoint
UPDATE "masters" SET "salon_id" = 'legacy-salon-' || "id";--> statement-breakpoint
INSERT INTO "salon_workspaces" ("id", "salon_id", "master_id", "name", "kind", "active")
SELECT 'legacy-workspace-' || m."id", m."salon_id", m."id", 'Основное место', 'chair', true
FROM "masters" m;--> statement-breakpoint
INSERT INTO "salon_memberships" ("id", "salon_id", "user_id", "role", "status")
SELECT 'legacy-salon-membership-' || m."id", m."salon_id", m."user_id", 'owner', 'active'
FROM "masters" m
WHERE m."user_id" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "users" u WHERE u."id" = m."user_id");