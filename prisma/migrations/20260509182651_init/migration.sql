-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "shopHandle" TEXT,
    "accessToken" TEXT,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "plan" TEXT NOT NULL DEFAULT 'BASIC',
    "currentPlanHandle" TEXT,
    "currentSubscriptionId" TEXT,
    "currentSubscriptionStatus" TEXT,
    "billingSyncedAt" TIMESTAMP(3),
    "locale" TEXT NOT NULL DEFAULT 'en',
    "brandingName" TEXT,
    "brandingPrimaryColor" TEXT,
    "merchantNotification" TEXT,
    "withdrawalDays" INTEGER NOT NULL DEFAULT 14,
    "legalPageUrl" TEXT,
    "privacyPageUrl" TEXT,
    "supportEmail" TEXT,
    "dpaAcceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WithdrawalRequest" (
    "id" TEXT NOT NULL,
    "publicReference" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "orderId" TEXT,
    "customerEmail" TEXT NOT NULL,
    "customerName" TEXT,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "source" TEXT NOT NULL DEFAULT 'STOREFRONT',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "legalCopyVersion" TEXT,
    "metadataJson" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',

    CONSTRAINT "WithdrawalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopDomain_key" ON "Shop"("shopDomain");

-- CreateIndex
CREATE UNIQUE INDEX "WithdrawalRequest_publicReference_key" ON "WithdrawalRequest"("publicReference");

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplate_shopId_code_key" ON "EmailTemplate"("shopId", "code");

-- AddForeignKey
ALTER TABLE "WithdrawalRequest" ADD CONSTRAINT "WithdrawalRequest_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
