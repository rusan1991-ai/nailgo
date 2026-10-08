ALTER TABLE "masters" ADD COLUMN "city" text DEFAULT 'Санкт-Петербург' NOT NULL;--> statement-breakpoint
ALTER TABLE "masters" ADD COLUMN "region" text DEFAULT 'Санкт-Петербург' NOT NULL;--> statement-breakpoint
ALTER TABLE "masters" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "masters" ADD COLUMN "lng" double precision;