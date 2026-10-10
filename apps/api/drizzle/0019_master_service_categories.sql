CREATE TABLE "service_categories" (
  "id" text PRIMARY KEY NOT NULL,
  "master_id" text NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "service_categories_master_id_masters_id_fk"
    FOREIGN KEY ("master_id") REFERENCES "masters"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "service_categories_master_name"
  ON "service_categories" USING btree ("master_id", "name");
--> statement-breakpoint
INSERT INTO "service_categories" ("id", "master_id", "name")
SELECT gen_random_uuid()::text, "master_id", "category"
FROM "services"
GROUP BY "master_id", "category"
ON CONFLICT ("master_id", "name") DO NOTHING;
