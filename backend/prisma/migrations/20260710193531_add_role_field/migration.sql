-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'user';

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");
