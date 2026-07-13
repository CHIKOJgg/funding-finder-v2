-- Web auth (wallet SIWE / Google) + NOWPayments crypto checkout.
-- Web users are stored with `telegramId` as the universal join key, using
-- synthetic ids like `wallet_0x...` / `google_<sub>` / `web_dev_<hex>`.

-- User: web-auth identity columns
ALTER TABLE "User" ADD COLUMN "auth_provider" TEXT NOT NULL DEFAULT 'telegram';
ALTER TABLE "User" ADD COLUMN "email" TEXT;
ALTER TABLE "User" ADD COLUMN "wallet_address" TEXT;
ALTER TABLE "User" ADD COLUMN "google_sub" TEXT;

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("wallet_address");
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("google_sub");

-- Invoice: NOWPayments provider + payment identifiers
ALTER TABLE "Invoice" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'crypto_pay';
ALTER TABLE "Invoice" ADD COLUMN "payment_id" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "pay_address" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "pay_currency" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "pay_amount" DOUBLE PRECISION;
ALTER TABLE "Invoice" ADD COLUMN "order_description" TEXT;

CREATE INDEX "Invoice_paymentId_idx" ON "Invoice"("payment_id");

-- Keep default exchange list in sync with the app
ALTER TABLE "UserSettings" ALTER COLUMN "defaultExchanges" SET DEFAULT ARRAY[
  'gate','binance','bybit','mexc','okx','bitget','bingx','phemex','woo',
  'hyperliquid','dydx','paradex','htx','coinex','blofin','bitmart','weex',
  'coinw','drift','helix','apex','aster','bluefin'
]::text[];
