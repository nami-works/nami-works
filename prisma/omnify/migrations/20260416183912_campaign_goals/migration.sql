-- CreateTable
CREATE TABLE "CampaignGoal" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "metric" TEXT NOT NULL DEFAULT 'bundle_orders',
    "matchRule" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignGoalTarget" (
    "id" TEXT NOT NULL,
    "campaignGoalId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "locationName" TEXT NOT NULL,
    "targetOrders" INTEGER NOT NULL,
    "baselineOrders" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignGoalTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignOrderMatch" (
    "id" TEXT NOT NULL,
    "campaignGoalId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "staffMemberId" TEXT,
    "matchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignOrderMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignGoal_shop_status_idx" ON "CampaignGoal"("shop", "status");

-- CreateIndex
CREATE INDEX "CampaignGoal_shop_startDate_endDate_idx" ON "CampaignGoal"("shop", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignGoalTarget_campaignGoalId_locationId_key" ON "CampaignGoalTarget"("campaignGoalId", "locationId");

-- CreateIndex
CREATE INDEX "CampaignOrderMatch_campaignGoalId_locationId_idx" ON "CampaignOrderMatch"("campaignGoalId", "locationId");

-- CreateIndex
CREATE INDEX "CampaignOrderMatch_shop_orderDate_idx" ON "CampaignOrderMatch"("shop", "orderDate");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignOrderMatch_campaignGoalId_orderId_key" ON "CampaignOrderMatch"("campaignGoalId", "orderId");

-- AddForeignKey
ALTER TABLE "CampaignGoalTarget" ADD CONSTRAINT "CampaignGoalTarget_campaignGoalId_fkey" FOREIGN KEY ("campaignGoalId") REFERENCES "CampaignGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignOrderMatch" ADD CONSTRAINT "CampaignOrderMatch_campaignGoalId_fkey" FOREIGN KEY ("campaignGoalId") REFERENCES "CampaignGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
