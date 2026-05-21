-- Drop unused BlogPostPreferences table
DROP TABLE IF EXISTS "BlogPostPreferences";

-- Add new fields to the BrandSettings table (logically renamed to BrandAssets in Prisma via @@map)
ALTER TABLE "BrandSettings"
  ADD COLUMN "exportVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "lastExportedAt" TIMESTAMP(3);
