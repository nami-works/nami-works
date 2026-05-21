-- AlterTable
ALTER TABLE "PriceTagConfig" ADD COLUMN     "displayNameKey" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "metaobjectFieldDefaults" TEXT NOT NULL DEFAULT '{}',
ALTER COLUMN "metafieldNamespace" SET DEFAULT '',
ALTER COLUMN "metafieldKey" SET DEFAULT '';
