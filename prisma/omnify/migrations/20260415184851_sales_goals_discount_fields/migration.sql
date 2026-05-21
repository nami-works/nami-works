-- AlterTable
ALTER TABLE "BlogPostJob" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProductImageAltSuggestion" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SalesOrderMonthly" ADD COLUMN     "totalDiscounts" DOUBLE PRECISION NOT NULL DEFAULT 0;
