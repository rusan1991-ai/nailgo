-- Этап 5: «магия»-вход и память о мессенджере.
--
-- * `magic_links` — одноразовые ссылки входа, привязанные к клиенту и записи.
--   `token_hash` проверяет ссылку, а `token_ciphertext` (AES-GCM) нужен только
--   фоновой доставке; после отправки или входа шифротекст удаляется. В `deliveries.body`
--   хранится плейсхолдер, не magic URL.
-- * `users.magic_auth_token` хранит хеш последней активной ссылки;
--   `preferred_messenger` в `users` и `master_clients` — выбор канала мастера.
CREATE TABLE "magic_links" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"booking_id" text,
	"token_hash" text NOT NULL,
	"token_ciphertext" text,
	"purpose" text DEFAULT 'booking' NOT NULL,
	"consumed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "magic_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "master_clients" ADD COLUMN "preferred_messenger" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferred_messenger" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "magic_auth_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "magic_auth_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "magic_links" ADD CONSTRAINT "magic_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "magic_links" ADD CONSTRAINT "magic_links_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "magic_links_user" ON "magic_links" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_magic_auth_token_unique" UNIQUE("magic_auth_token");