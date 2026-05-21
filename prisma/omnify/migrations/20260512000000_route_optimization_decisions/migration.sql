-- Route Optimization Decisions (Phase 1.6)
-- Additive table; no existing read paths reference it. Written once per
-- handleOptimize call beginning in Phase 1.7; read by the post-mortem
-- panel (Phase 3).

-- CreateTable
CREATE TABLE "RouteOptimizationDecision" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "ordersDataJson" JSONB NOT NULL,
    "candidatesJson" JSONB NOT NULL,
    "ruleResultsJson" JSONB NOT NULL,
    "quoteResultsJson" JSONB NOT NULL,
    "reasonerOutputJson" JSONB,
    "winningCandidateId" TEXT NOT NULL,
    "decisionPath" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "costSubunits" INTEGER NOT NULL,
    "costCurrency" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "postMortemFlagsJson" JSONB NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "arbiterVersion" TEXT NOT NULL,
    "operatorReviewed" BOOLEAN NOT NULL DEFAULT false,
    "operatorVerdict" TEXT,
    "operatorComment" TEXT,
    "dispatchJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouteOptimizationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RouteOptimizationDecision_shop_locationId_createdAt_idx" ON "RouteOptimizationDecision"("shop", "locationId", "createdAt");

-- CreateIndex
CREATE INDEX "RouteOptimizationDecision_shop_operatorReviewed_createdAt_idx" ON "RouteOptimizationDecision"("shop", "operatorReviewed", "createdAt");

-- CreateIndex
CREATE INDEX "RouteOptimizationDecision_shop_decisionPath_createdAt_idx" ON "RouteOptimizationDecision"("shop", "decisionPath", "createdAt");
