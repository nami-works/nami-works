-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('quiz_done', 'confirmed', 'waitlist', 'matched', 'accepted');

-- CreateTable
CREATE TABLE "matchmaking_submissions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fase" TEXT NOT NULL,
    "dor" TEXT NOT NULL,
    "caminhos" JSONB NOT NULL,
    "seguimentos" JSONB NOT NULL,
    "valor" TEXT NOT NULL,
    "diagnosticoTexto" TEXT NOT NULL,
    "inNetwork" BOOLEAN NOT NULL,
    "tierRecomendado" TEXT,
    "tierEscolhido" TEXT,
    "nome" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'quiz_done',
    "persona" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,

    CONSTRAINT "matchmaking_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "matchmaking_submissions_status_idx" ON "matchmaking_submissions"("status");

-- CreateIndex
CREATE INDEX "matchmaking_submissions_persona_idx" ON "matchmaking_submissions"("persona");
