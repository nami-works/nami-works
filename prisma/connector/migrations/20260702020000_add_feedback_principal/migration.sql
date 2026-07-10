-- Attribute feedback to the submitting principal (per-user). Additive + nullable.
ALTER TABLE "Feedback" ADD COLUMN IF NOT EXISTS "principalId" TEXT;
ALTER TABLE "Feedback" ADD COLUMN IF NOT EXISTS "principalLabel" TEXT;
