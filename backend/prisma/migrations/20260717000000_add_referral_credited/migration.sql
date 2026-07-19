-- Add `referralCredited` flag to Order so the referrer bonus is granted exactly
-- once per paid order (guards against replayed webhooks / status polls double
-- crediting the referrer's balance).

ALTER TABLE "Order" ADD COLUMN "referralCredited" BOOLEAN NOT NULL DEFAULT false;
