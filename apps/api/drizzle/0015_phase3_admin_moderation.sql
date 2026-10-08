-- Этап 3: админка — модерация мастеров, жалобы на отзывы и блокировка аккаунтов.
--
-- Модерация мастеров: активный принимает записи и виден в витрине, `paused`
-- снят с публикации (кабинет открыт), `blocked` — блокировка аккаунта целиком.
ALTER TABLE "masters" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "masters" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "masters" ADD COLUMN "status_changed_at" timestamp with time zone;--> statement-breakpoint

-- Блокировка учётной записи: блокирует вход любой роли, снимается админом.
ALTER TABLE "users" ADD COLUMN "blocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "blocked_reason" text;--> statement-breakpoint

-- Жалоба мастера на отзыв: не снимает публикацию сама, решение за админом.
ALTER TABLE "reviews" ADD COLUMN "complaint_text" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "complaint_at" timestamp with time zone;
