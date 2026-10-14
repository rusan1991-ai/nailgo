-- Master-specific preference for in-app notifications about new bookings.
ALTER TABLE "masters" ADD COLUMN "notify_new_bookings" boolean DEFAULT true NOT NULL;
