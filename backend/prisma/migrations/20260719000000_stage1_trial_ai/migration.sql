-- Stage 1 CMO plan: trial reminders + 1 free AI tip/day tracking

ALTER TABLE "User" ADD COLUMN "trialReminderSent" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lastFreeAiAt" TIMESTAMP(3);
