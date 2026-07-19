-- Stage 3 CMO plan: annual billing period on orders

ALTER TABLE "Order" ADD COLUMN "billingPeriod" TEXT NOT NULL DEFAULT 'monthly';
