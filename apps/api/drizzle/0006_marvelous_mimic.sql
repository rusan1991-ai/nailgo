ALTER TABLE "reviews" ADD COLUMN "booking_id" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "client_phone" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "reply_text" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "replied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_booking" ON "reviews" USING btree ("booking_id");