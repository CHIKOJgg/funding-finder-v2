-- Add opt-in "new spread" (arbitrage opportunity) push notifications.
ALTER TABLE "UserSettings" ADD COLUMN "spreadNotifications" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UserSettings" ADD COLUMN "spreadMinThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.002;
