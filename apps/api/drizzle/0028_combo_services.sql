CREATE TABLE "combo_booking_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"booking_id" text NOT NULL,
	"step_order" integer NOT NULL,
	"performer_master_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"step_name" text NOT NULL,
	"performer_name" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"price" integer NOT NULL,
	"gap_after_minutes" integer DEFAULT 0 NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"reserved_end_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "combo_booking_steps_order_nonnegative" CHECK ("combo_booking_steps"."step_order" >= 0),
	CONSTRAINT "combo_booking_steps_duration_positive" CHECK ("combo_booking_steps"."duration_minutes" > 0),
	CONSTRAINT "combo_booking_steps_price_nonnegative" CHECK ("combo_booking_steps"."price" >= 0),
	CONSTRAINT "combo_booking_steps_reserved_interval" CHECK ("combo_booking_steps"."end_at" > "combo_booking_steps"."start_at" AND "combo_booking_steps"."reserved_end_at" >= "combo_booking_steps"."end_at")
);
--> statement-breakpoint
CREATE TABLE "combo_service_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id" text NOT NULL,
	"step_order" integer NOT NULL,
	"performer_master_id" text NOT NULL,
	"name" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"price" integer NOT NULL,
	"gap_after_minutes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "combo_service_steps_order_nonnegative" CHECK ("combo_service_steps"."step_order" >= 0),
	CONSTRAINT "combo_service_steps_duration_positive" CHECK ("combo_service_steps"."duration_minutes" > 0),
	CONSTRAINT "combo_service_steps_price_nonnegative" CHECK ("combo_service_steps"."price" >= 0),
	CONSTRAINT "combo_service_steps_gap_nonnegative" CHECK ("combo_service_steps"."gap_after_minutes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "kind" text DEFAULT 'service' NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "combo_salon_id" text;--> statement-breakpoint
ALTER TABLE "combo_booking_steps" ADD CONSTRAINT "combo_booking_steps_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "combo_booking_steps" ADD CONSTRAINT "combo_booking_steps_performer_master_id_masters_id_fk" FOREIGN KEY ("performer_master_id") REFERENCES "public"."masters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "combo_booking_steps" ADD CONSTRAINT "combo_booking_steps_workspace_id_salon_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."salon_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "combo_service_steps" ADD CONSTRAINT "combo_service_steps_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "combo_service_steps" ADD CONSTRAINT "combo_service_steps_performer_master_id_masters_id_fk" FOREIGN KEY ("performer_master_id") REFERENCES "public"."masters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "combo_booking_steps_booking_order" ON "combo_booking_steps" USING btree ("booking_id","step_order");--> statement-breakpoint
CREATE INDEX "combo_booking_steps_performer_start" ON "combo_booking_steps" USING btree ("performer_master_id","start_at");--> statement-breakpoint
CREATE INDEX "combo_booking_steps_workspace_start" ON "combo_booking_steps" USING btree ("workspace_id","start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "combo_service_steps_service_order" ON "combo_service_steps" USING btree ("service_id","step_order");--> statement-breakpoint
CREATE INDEX "combo_service_steps_performer" ON "combo_service_steps" USING btree ("performer_master_id");--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_combo_salon_id_salons_id_fk" FOREIGN KEY ("combo_salon_id") REFERENCES "public"."salons"("id") ON DELETE set null ON UPDATE no action;