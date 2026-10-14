-- Ensure every master created after the salon migration has a private primary workspace.
-- Keep an existing master.salon_id when it already points to a salon; legacy profiles
-- with no salon get a dedicated salon, workspace and owner membership.
INSERT INTO "salons" ("id", "name", "owner_user_id", "location_id", "timezone", "active")
SELECT 'workspace-salon-' || m."id", m."name" || ' — основное место',
       CASE WHEN EXISTS (SELECT 1 FROM "users" u WHERE u."id" = m."user_id") THEN m."user_id" ELSE NULL END,
       m."location_id", m."timezone", true
FROM "masters" m
WHERE m."salon_id" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "salon_workspaces" sw WHERE sw."master_id" = m."id");--> statement-breakpoint
INSERT INTO "salon_workspaces" ("id", "salon_id", "master_id", "name", "kind", "active")
SELECT 'workspace-default-' || m."id", COALESCE(m."salon_id", 'workspace-salon-' || m."id"),
       m."id", 'Основное место', 'chair', true
FROM "masters" m
WHERE NOT EXISTS (SELECT 1 FROM "salon_workspaces" sw WHERE sw."master_id" = m."id");--> statement-breakpoint
UPDATE "masters" m
SET "salon_id" = (
  SELECT sw."salon_id" FROM "salon_workspaces" sw
  WHERE sw."master_id" = m."id"
  ORDER BY CASE WHEN sw."salon_id" = m."salon_id" THEN 0 ELSE 1 END, sw."created_at", sw."id"
  LIMIT 1
)
WHERE m."salon_id" IS NULL
  AND EXISTS (SELECT 1 FROM "salon_workspaces" sw WHERE sw."master_id" = m."id");--> statement-breakpoint
INSERT INTO "salon_memberships" ("id", "salon_id", "user_id", "role", "status")
SELECT 'workspace-owner-' || m."id", m."salon_id", m."user_id", 'owner', 'active'
FROM "masters" m
WHERE m."user_id" IS NOT NULL
  AND m."salon_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "salon_memberships" sm
    WHERE sm."salon_id" = m."salon_id" AND sm."user_id" = m."user_id"
  );--> statement-breakpoint
ALTER TABLE "working_hours" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "working_hours" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "time_blocks" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "workspace_id" text;--> statement-breakpoint
UPDATE "working_hours" wh
SET "workspace_id" = (
  SELECT sw."id" FROM "salon_workspaces" sw
  JOIN "masters" m ON m."id" = wh."master_id"
  WHERE sw."master_id" = wh."master_id"
  ORDER BY CASE WHEN sw."salon_id" = m."salon_id" THEN 0 ELSE 1 END, sw."created_at", sw."id"
  LIMIT 1
);--> statement-breakpoint
UPDATE "time_blocks" tb
SET "workspace_id" = (
  SELECT sw."id" FROM "salon_workspaces" sw
  JOIN "masters" m ON m."id" = tb."master_id"
  WHERE sw."master_id" = tb."master_id"
  ORDER BY CASE WHEN sw."salon_id" = m."salon_id" THEN 0 ELSE 1 END, sw."created_at", sw."id"
  LIMIT 1
);--> statement-breakpoint
UPDATE "bookings" b
SET "workspace_id" = (
  SELECT sw."id" FROM "salon_workspaces" sw
  JOIN "masters" m ON m."id" = b."master_id"
  WHERE sw."master_id" = b."master_id"
  ORDER BY CASE WHEN sw."salon_id" = m."salon_id" THEN 0 ELSE 1 END, sw."created_at", sw."id"
  LIMIT 1
);--> statement-breakpoint
ALTER TABLE "working_hours" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "time_blocks" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_workspace_id_salon_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."salon_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_workspace_id_salon_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."salon_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_workspace_id_salon_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."salon_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DROP INDEX "working_hours_master_weekday";--> statement-breakpoint
CREATE INDEX "bookings_workspace_start" ON "bookings" USING btree ("workspace_id","start_at");--> statement-breakpoint
CREATE INDEX "time_blocks_workspace_start" ON "time_blocks" USING btree ("workspace_id","start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "working_hours_workspace_weekday" ON "working_hours" USING btree ("workspace_id","weekday");--> statement-breakpoint
CREATE INDEX "working_hours_master_workspace" ON "working_hours" USING btree ("master_id","workspace_id");
