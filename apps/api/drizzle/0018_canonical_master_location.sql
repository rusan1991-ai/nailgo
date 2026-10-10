-- Привязка профиля мастера к каноническому месту из справочника.
ALTER TABLE "masters" ADD COLUMN "location_id" text;
--> statement-breakpoint
ALTER TABLE "masters" ADD CONSTRAINT "masters_location_id_locations_id_fk"
  FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "masters_location_id" ON "masters" USING btree ("location_id");
