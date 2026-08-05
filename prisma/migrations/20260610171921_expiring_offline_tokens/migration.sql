-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "accessTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "refreshToken" TEXT,
ADD COLUMN     "refreshTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "tokenType" TEXT DEFAULT 'NON_EXPIRING_OFFLINE';
