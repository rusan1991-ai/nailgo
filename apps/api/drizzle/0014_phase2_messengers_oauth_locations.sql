-- Этап 2: мессенджеры, OAuth, гео-справочник и медиа мастеров.
--
-- Файл собран drizzle-kit (снимок 0014) и почищен вручную: генератор увидел
-- этап 1 ещё раз, потому что снимок 0013 отставал от рукописной миграции.
-- Здесь остались только изменения этапа 2.

-- SMS больше не покупаем: телефон — обычный контакт, может отсутствовать
-- (номер уникален, но NULL-ы допустимы).
ALTER TABLE "users" ALTER COLUMN "phone" DROP NOT NULL;--> statement-breakpoint

-- Один аккаунт — много способов входа. Привязка внешней учётки: Яндекс ID,
-- VK ID, Telegram, Max или телефон. Пара (provider, provider_user_id)
-- уникальна: один внешний аккаунт не может открывать чужой кабинет.
CREATE TABLE "identities" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"username" text,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "identities_provider_user" ON "identities" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE INDEX "identities_user" ON "identities" USING btree ("user_id");--> statement-breakpoint

-- Незавершённые входы: OAuth-редирект (state + PKCE) и диплинк в бота
-- (одноразовый токен). Одноразовость держит поле status.
CREATE TABLE "auth_flows" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"token" text NOT NULL,
	"code_verifier" text,
	"return_to" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider_user_id" text,
	"display_name" text,
	"username" text,
	"avatar_url" text,
	"user_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_flows_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE INDEX "auth_flows_status" ON "auth_flows" USING btree ("status","expires_at");--> statement-breakpoint

-- Справочник мест: станции метро Санкт-Петербурга и города области.
-- Мастер выбирает значение, поэтому фильтр витрины не разваливается от опечаток.
CREATE TABLE "locations" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"region" text DEFAULT 'Санкт-Петербург' NOT NULL,
	"line" text,
	"color" text,
	"lat" double precision,
	"lng" double precision,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "locations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE INDEX "locations_kind" ON "locations" USING btree ("kind","sort");--> statement-breakpoint

-- Медиа мастера: аватар, портфолио, сертификат. Файлы лежат в MEDIA_DIR
-- в двух вариантах (web и thumb), в базе — только метаданные.
CREATE TABLE "master_media" (
	"id" text PRIMARY KEY NOT NULL,
	"master_id" text NOT NULL,
	"kind" text NOT NULL,
	"file_name" text NOT NULL,
	"mime" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"size_bytes" integer NOT NULL,
	"caption" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "master_media_master" ON "master_media" USING btree ("master_id","kind","sort");--> statement-breakpoint

-- Запись привязывается к аккаунту: гостю без входа её больше не «пришьёшь».
ALTER TABLE "bookings" ADD COLUMN "user_id" text;--> statement-breakpoint

-- Избранное тоже может принадлежать аккаунту; телефон у него теперь необязателен.
ALTER TABLE "favorites" ALTER COLUMN "client_phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "favorites" ADD COLUMN "user_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "favorites_user_master" ON "favorites" USING btree ("user_id","master_id");--> statement-breakpoint

-- Гео-привязка мастера к справочнику.
ALTER TABLE "masters" ADD COLUMN "metro_slug" text;--> statement-breakpoint
ALTER TABLE "masters" ADD COLUMN "district_slug" text;
