-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "emailDeliveryMethod" TEXT NOT NULL DEFAULT 'GL6',
ADD COLUMN     "resendDomainCreatedAt" TIMESTAMP(3),
ADD COLUMN     "resendDomainId" TEXT,
ADD COLUMN     "resendDomainLastError" TEXT,
ADD COLUMN     "resendDomainName" TEXT,
ADD COLUMN     "resendDomainStatus" TEXT,
ADD COLUMN     "resendDomainVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "resendFromEmail" TEXT,
ADD COLUMN     "resendFromName" TEXT;
