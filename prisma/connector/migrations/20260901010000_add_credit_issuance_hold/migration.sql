-- 72h hold between order-confirmed and actual credit issuance (Lucas, 2026-09-01).
-- issuedAt used to be set at row-creation time (credit issued immediately);
-- it's now set only when the sweep actually issues, so it has to become
-- nullable. createdAt takes over as the always-set "row created" timestamp,
-- backfilled from the old issuedAt for existing (already-issued) rows.

ALTER TABLE "JustBoughtCreditIssuance" ADD COLUMN "createdAt" TIMESTAMP(3);
UPDATE "JustBoughtCreditIssuance" SET "createdAt" = "issuedAt" WHERE "createdAt" IS NULL;
ALTER TABLE "JustBoughtCreditIssuance" ALTER COLUMN "createdAt" SET NOT NULL;
ALTER TABLE "JustBoughtCreditIssuance" ALTER COLUMN "createdAt" SET DEFAULT now();

ALTER TABLE "JustBoughtCreditIssuance" ADD COLUMN "holdUntil" TIMESTAMP(3);

ALTER TABLE "JustBoughtCreditIssuance" ALTER COLUMN "issuedAt" DROP NOT NULL;
ALTER TABLE "JustBoughtCreditIssuance" ALTER COLUMN "issuedAt" DROP DEFAULT;
