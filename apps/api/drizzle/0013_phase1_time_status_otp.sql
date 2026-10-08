-- Этап 1: часовые пояса, правила записи, жизненный цикл, защита кода входа.
-- Миграция написана вручную: drizzle-kit не может решить, переименование это
-- или удаление+добавление (otp_codes.code → code_hash), а решать должен человек.

--> statement-breakpoint
-- Пояс мастера: «минуты дня» и тексты сообщений считаются в нём, а не в поясе
-- сервера. Плюс свой шаг сетки слотов (0 — общий из SLOT_STEP_MINUTES)
-- и задел на салоны второй версии.
ALTER TABLE "masters" ADD COLUMN "timezone" text DEFAULT 'Europe/Moscow' NOT NULL;--> statement-breakpoint
ALTER TABLE "masters" ADD COLUMN "slot_step_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "masters" ADD COLUMN "salon_id" text;--> statement-breakpoint

-- Дисциплина клиента: площадка — агрегатор и денег не списывает, поэтому
-- «штраф» — это учёт поздних отмен и неявок.
ALTER TABLE "users" ADD COLUMN "late_cancellations" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "no_show_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "prepayment_required_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "blacklisted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "blacklist_reason" text;--> statement-breakpoint

-- Кто и почему отменил визит, когда запись последний раз менялась.
ALTER TABLE "bookings" ADD COLUMN "cancelled_by" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint

-- Журнал жизненного цикла: append-only история статусов записи.
CREATE TABLE "booking_events" (
	"id" text PRIMARY KEY NOT NULL,
	"booking_id" text NOT NULL,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"actor_role" text NOT NULL,
	"actor_user_id" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_events_booking" ON "booking_events" USING btree ("booking_id","created_at");--> statement-breakpoint

-- Коды входа хранятся хешем: утечка базы не даёт войти под клиентом.
-- Прежние коды не жалко — они живут 5 минут, поэтому таблицу чистим и
-- переходим на новую колонку.
DELETE FROM "otp_codes";--> statement-breakpoint
ALTER TABLE "otp_codes" DROP COLUMN "code";--> statement-breakpoint
ALTER TABLE "otp_codes" ADD COLUMN "code_hash" text NOT NULL;--> statement-breakpoint

-- Скользящее окно для лимитов запроса/ввода кода.
CREATE TABLE "rate_limit_hits" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rate_limit_key_time" ON "rate_limit_hits" USING btree ("key","created_at");

--> statement-breakpoint
-- Причина скрытия отзыва: админ прячет по жалобе мастера и объясняет почему.
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "hidden_reason" text;
