-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorklistContactEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerGid" TEXT NOT NULL,
    "locationKey" TEXT NOT NULL,
    "repEmail" TEXT NOT NULL,
    "contactedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "convertedAt" TIMESTAMP(3),
    "convertedOrderGid" TEXT,
    "unconvertedAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),
    "skipReason" TEXT,

    CONSTRAINT "WorklistContactEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorklistContactEvent_shop_customerGid_contactedAt_idx" ON "WorklistContactEvent"("shop", "customerGid", "contactedAt");

-- CreateIndex
CREATE INDEX "WorklistContactEvent_shop_locationKey_contactedAt_idx" ON "WorklistContactEvent"("shop", "locationKey", "contactedAt");

-- CreateIndex
CREATE INDEX "WorklistContactEvent_shop_convertedOrderGid_idx" ON "WorklistContactEvent"("shop", "convertedOrderGid");

