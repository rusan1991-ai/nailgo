ALTER TABLE "services" ADD COLUMN "master_id" text;--> statement-breakpoint
UPDATE "services" SET "master_id" = (SELECT "id" FROM "masters" ORDER BY "slug" LIMIT 1) WHERE "master_id" IS NULL;--> statement-breakpoint
ALTER TABLE "services" ALTER COLUMN "master_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_master_id_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."masters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "services_master" ON "services" USING btree ("master_id");
