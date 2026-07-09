-- Repoint user-scoped foreign keys from User(id) to User(telegramId).
-- The application uses the Telegram id (e.g. "tg_12345") as the userId value
-- everywhere, so the FK targets must reference the unique telegramId column.

-- Drop existing constraints (referencing User(id))
ALTER TABLE "UserSettings" DROP CONSTRAINT "UserSettings_userId_fkey";
ALTER TABLE "Order" DROP CONSTRAINT "Order_userId_fkey";
ALTER TABLE "Withdrawal" DROP CONSTRAINT "Withdrawal_userId_fkey";
ALTER TABLE "PaymentHistory" DROP CONSTRAINT "PaymentHistory_userId_fkey";
ALTER TABLE "GeneralAlert" DROP CONSTRAINT "GeneralAlert_userId_fkey";
ALTER TABLE "ArbitrageAlert" DROP CONSTRAINT "ArbitrageAlert_userId_fkey";

-- Recreate constraints (referencing User(telegramId))
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("telegramId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("telegramId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("telegramId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentHistory" ADD CONSTRAINT "PaymentHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("telegramId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GeneralAlert" ADD CONSTRAINT "GeneralAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("telegramId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ArbitrageAlert" ADD CONSTRAINT "ArbitrageAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("telegramId") ON DELETE RESTRICT ON UPDATE CASCADE;
