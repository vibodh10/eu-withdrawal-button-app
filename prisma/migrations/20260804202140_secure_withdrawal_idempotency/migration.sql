/*
  Warnings:

  - A unique constraint covering the columns `[submissionKey]` on the table `WithdrawalRequest` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "WithdrawalRequest" ADD COLUMN     "confirmationSentAt" TIMESTAMP(3),
ADD COLUMN     "emailProviderId" TEXT,
ADD COLUMN     "emailStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "submissionKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "WithdrawalRequest_submissionKey_key" ON "WithdrawalRequest"("submissionKey");

-- CreateIndex
CREATE INDEX "WithdrawalRequest_shopId_createdAt_idx" ON "WithdrawalRequest"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "WithdrawalRequest_shopId_orderId_idx" ON "WithdrawalRequest"("shopId", "orderId");
