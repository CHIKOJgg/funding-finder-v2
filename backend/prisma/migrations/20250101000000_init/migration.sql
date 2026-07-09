-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "subscription" TEXT NOT NULL DEFAULT 'free',
    "trialUsed" BOOLEAN NOT NULL DEFAULT false,
    "trialScans" INTEGER NOT NULL DEFAULT 1,
    "referralCode" TEXT NOT NULL,
    "referredBy" TEXT,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastActive" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "telegramNotifications" BOOLEAN NOT NULL DEFAULT true,
    "emailNotifications" BOOLEAN NOT NULL DEFAULT false,
    "emailAddress" TEXT,
    "dailySummary" BOOLEAN NOT NULL DEFAULT true,
    "alertSound" BOOLEAN NOT NULL DEFAULT true,
    "defaultExchanges" TEXT[] DEFAULT ARRAY['gate', 'binance', 'bybit', 'mexc', 'okx']::TEXT[],
    "theme" TEXT NOT NULL DEFAULT 'auto',
    "language" TEXT NOT NULL DEFAULT 'ru',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "minVolumeFilter" DOUBLE PRECISION NOT NULL DEFAULT 1000,
    "minRateFilter" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USDT',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "invoiceId" TEXT,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "hash" TEXT,
    "botInvoiceUrl" TEXT,
    "miniAppInvoiceUrl" TEXT,
    "webAppInvoiceUrl" TEXT,
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Withdrawal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "PaymentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRecord" (
    "id" TEXT NOT NULL,
    "paymentHistoryId" TEXT NOT NULL,
    "orderId" TEXT,
    "plan" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneralAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pair" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "cooldown" INTEGER NOT NULL DEFAULT 300000,
    "lastTriggered" TIMESTAMP(3),
    "triggerCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneralAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArbitrageAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pair" TEXT NOT NULL,
    "exchangeA" TEXT NOT NULL,
    "exchangeB" TEXT NOT NULL,
    "condition" TEXT NOT NULL DEFAULT 'difference',
    "threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.002,
    "direction" TEXT NOT NULL DEFAULT 'both',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "cooldown" INTEGER NOT NULL DEFAULT 300000,
    "lastTriggered" TIMESTAMP(3),
    "triggerCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArbitrageAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingHistory" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,

    CONSTRAINT "FundingHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingRecord" (
    "id" TEXT NOT NULL,
    "fundingHistoryId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "funding" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "FundingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertTrigger" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" TEXT,

    CONSTRAINT "AlertTrigger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractMetadata" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "contract" TEXT NOT NULL,
    "settleCurrency" TEXT NOT NULL DEFAULT 'usdt',
    "baseCurrency" TEXT,
    "quoteCurrency" TEXT,
    "tickSize" DOUBLE PRECISION,
    "minQty" DOUBLE PRECISION,
    "maxLeverage" INTEGER,
    "fundingCap" DOUBLE PRECISION,
    "fundingFloor" DOUBLE PRECISION,
    "openInterest" DOUBLE PRECISION,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- CreateIndex
CREATE INDEX "User_subscription_idx" ON "User"("subscription");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE INDEX "User_lastActive_idx" ON "User"("lastActive");

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- CreateIndex
CREATE INDEX "Order_userId_idx" ON "Order"("userId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_orderId_key" ON "Invoice"("orderId");

-- CreateIndex
CREATE INDEX "Invoice_invoiceId_idx" ON "Invoice"("invoiceId");

-- CreateIndex
CREATE INDEX "Withdrawal_userId_idx" ON "Withdrawal"("userId");

-- CreateIndex
CREATE INDEX "Withdrawal_status_idx" ON "Withdrawal"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentHistory_userId_key" ON "PaymentHistory"("userId");

-- CreateIndex
CREATE INDEX "PaymentRecord_paymentHistoryId_idx" ON "PaymentRecord"("paymentHistoryId");

-- CreateIndex
CREATE INDEX "GeneralAlert_userId_idx" ON "GeneralAlert"("userId");

-- CreateIndex
CREATE INDEX "GeneralAlert_isActive_idx" ON "GeneralAlert"("isActive");

-- CreateIndex
CREATE INDEX "GeneralAlert_exchange_pair_idx" ON "GeneralAlert"("exchange", "pair");

-- CreateIndex
CREATE INDEX "ArbitrageAlert_userId_idx" ON "ArbitrageAlert"("userId");

-- CreateIndex
CREATE INDEX "ArbitrageAlert_isActive_idx" ON "ArbitrageAlert"("isActive");

-- CreateIndex
CREATE INDEX "ArbitrageAlert_pair_exchangeA_exchangeB_idx" ON "ArbitrageAlert"("pair", "exchangeA", "exchangeB");

-- CreateIndex
CREATE UNIQUE INDEX "FundingHistory_key_key" ON "FundingHistory"("key");

-- CreateIndex
CREATE INDEX "FundingHistory_key_idx" ON "FundingHistory"("key");

-- CreateIndex
CREATE INDEX "FundingRecord_fundingHistoryId_idx" ON "FundingRecord"("fundingHistoryId");

-- CreateIndex
CREATE INDEX "FundingRecord_timestamp_idx" ON "FundingRecord"("timestamp");

-- CreateIndex
CREATE INDEX "AlertTrigger_alertId_idx" ON "AlertTrigger"("alertId");

-- CreateIndex
CREATE INDEX "AlertTrigger_triggeredAt_idx" ON "AlertTrigger"("triggeredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContractMetadata_key_key" ON "ContractMetadata"("key");

-- CreateIndex
CREATE INDEX "ContractMetadata_exchange_idx" ON "ContractMetadata"("exchange");

-- CreateIndex
CREATE INDEX "ContractMetadata_baseCurrency_idx" ON "ContractMetadata"("baseCurrency");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referredBy_fkey" FOREIGN KEY ("referredBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentHistory" ADD CONSTRAINT "PaymentHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_paymentHistoryId_fkey" FOREIGN KEY ("paymentHistoryId") REFERENCES "PaymentHistory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneralAlert" ADD CONSTRAINT "GeneralAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArbitrageAlert" ADD CONSTRAINT "ArbitrageAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingRecord" ADD CONSTRAINT "FundingRecord_fundingHistoryId_fkey" FOREIGN KEY ("fundingHistoryId") REFERENCES "FundingHistory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
