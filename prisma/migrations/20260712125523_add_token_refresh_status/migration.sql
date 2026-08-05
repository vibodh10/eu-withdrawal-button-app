-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "lastTokenRefreshAt" TIMESTAMP(3),
ADD COLUMN     "tokenRefreshError" TEXT,
ADD COLUMN     "tokenStatus" TEXT DEFAULT 'ACTIVE';
