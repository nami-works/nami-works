-- AlterTable
ALTER TABLE "BulkPriceCampaign" ADD COLUMN     "priceTagDisplayNameKey" TEXT,
ADD COLUMN     "priceTagFieldDefaults" TEXT,
ADD COLUMN     "priceTagMetafieldKey" TEXT,
ADD COLUMN     "priceTagMetafieldNamespace" TEXT,
ADD COLUMN     "priceTagMetaobjectType" TEXT,
ADD COLUMN     "priceTagsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PriceTagConfig" ADD COLUMN     "webhookSyncEnabled" BOOLEAN NOT NULL DEFAULT false;
