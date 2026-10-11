-- Canonical service category relation. The text label remains for historical
-- snapshots and public API compatibility; null category_id is the
-- «Без категории» bucket.
ALTER TABLE "services" ADD COLUMN "category_id" text;
--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_category_id_service_categories_id_fk"
  FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "services_category" ON "services" USING btree ("category_id");
--> statement-breakpoint
UPDATE "services" AS service
SET "category_id" = category."id"
FROM "service_categories" AS category
WHERE category."master_id" = service."master_id"
  AND category."name" = service."category";
--> statement-breakpoint

-- Account-owned favorites: do not use a phone supplied by the caller as scope.
CREATE TABLE "client_favorite_masters" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "master_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "client_favorite_masters_client_id_users_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE cascade,
  CONSTRAINT "client_favorite_masters_master_id_masters_id_fk"
    FOREIGN KEY ("master_id") REFERENCES "masters"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "client_favorite_masters_client_master"
  ON "client_favorite_masters" USING btree ("client_id", "master_id");
--> statement-breakpoint
CREATE INDEX "client_favorite_masters_master"
  ON "client_favorite_masters" USING btree ("master_id");
--> statement-breakpoint

-- Keep favorites belonging to existing accounts, matching legacy phone-only
-- rows to the unique account phone where possible.
INSERT INTO "client_favorite_masters" ("id", "client_id", "master_id", "created_at")
SELECT gen_random_uuid()::text, favorite_owner."client_id", favorite_owner."master_id", min(favorite_owner."created_at")
FROM (
  SELECT favorite."user_id" AS "client_id", favorite."master_id", favorite."created_at"
  FROM "favorites" AS favorite
  WHERE favorite."user_id" IS NOT NULL
  UNION ALL
  SELECT account."id" AS "client_id", favorite."master_id", favorite."created_at"
  FROM "favorites" AS favorite
  INNER JOIN "users" AS account ON account."phone" = favorite."client_phone"
  WHERE favorite."client_phone" IS NOT NULL
) AS favorite_owner
GROUP BY favorite_owner."client_id", favorite_owner."master_id"
ON CONFLICT ("client_id", "master_id") DO NOTHING;
