-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "smtpEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "smtpFromEmail" TEXT,
ADD COLUMN     "smtpFromName" TEXT,
ADD COLUMN     "smtpHost" TEXT,
ADD COLUMN     "smtpLastError" TEXT,
ADD COLUMN     "smtpPasswordEncrypted" TEXT,
ADD COLUMN     "smtpPort" INTEGER,
ADD COLUMN     "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "smtpUsername" TEXT,
ADD COLUMN     "smtpVerifiedAt" TIMESTAMP(3);
