ALTER TABLE "salon_memberships" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "salon_memberships" ADD COLUMN "invitation_phone" text;--> statement-breakpoint
CREATE UNIQUE INDEX "salon_memberships_salon_invite_phone" ON "salon_memberships" USING btree ("salon_id","invitation_phone") WHERE "salon_memberships"."invitation_phone" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "salon_memberships_invitation_phone" ON "salon_memberships" USING btree ("invitation_phone","status","invitation_expires_at");--> statement-breakpoint
ALTER TABLE "salon_memberships" ADD CONSTRAINT "salon_memberships_invitee_required" CHECK ("salon_memberships"."user_id" IS NOT NULL OR ("salon_memberships"."invitation_phone" IS NOT NULL AND "salon_memberships"."status" <> 'active'));