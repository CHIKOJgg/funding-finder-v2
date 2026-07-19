-- Make PaymentRecord.orderId unique so a paid order can never produce
-- duplicate payment-history rows, even when updateOrderFromWebhook is called
-- concurrently from multiple entry points (webhook, status poll, simulate,
-- NOWPayments reconcile). The application also does an explicit upsert, but the
-- DB constraint is the ultimate guard.

CREATE UNIQUE INDEX "PaymentRecord_orderId_key" ON "PaymentRecord"("orderId")
  WHERE "orderId" IS NOT NULL;
