CREATE TABLE "journal_articles" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"excerpt" text,
	"content" text NOT NULL,
	"cover_url" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal_articles" ADD CONSTRAINT "journal_articles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "journal_articles_slug" ON "journal_articles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "journal_articles_public" ON "journal_articles" USING btree ("status","published_at");--> statement-breakpoint
CREATE INDEX "journal_articles_category" ON "journal_articles" USING btree ("category");