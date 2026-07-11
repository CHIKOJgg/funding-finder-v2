-- CreateTable
CREATE TABLE "ExecutedOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL DEFAULT 'long',
    "notionalUsd" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "orderId" TEXT,
    "raw" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutedOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExecutedOrder_userId_idx" ON "ExecutedOrder"("userId");
CREATE INDEX "ExecutedOrder_createdAt_idx" ON "ExecutedOrder"("createdAt");

-- AddForeignKey
ALTER TABLE "ExecutedOrder" ADD CONSTRAINT "ExecutedOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("telegramId") ON DELETE CASCADE ON UPDATE CASCADE;
