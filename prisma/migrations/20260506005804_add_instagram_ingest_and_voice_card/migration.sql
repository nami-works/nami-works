-- CreateTable
CREATE TABLE "InstagramAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "igUserId" TEXT NOT NULL,
    "username" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastCursor" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstagramAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstagramPost" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "igMediaId" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "caption" TEXT,
    "permalink" TEXT,
    "mediaUrl" TEXT,
    "thumbnailUrl" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "likeCount" INTEGER,
    "commentsCount" INTEGER,
    "children" JSONB,
    "raw" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstagramPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceCard" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modelId" TEXT NOT NULL,
    "corpusSize" INTEGER NOT NULL,
    "card" JSONB NOT NULL,
    "notes" TEXT,

    CONSTRAINT "VoiceCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstagramAccount_tenantId_key" ON "InstagramAccount"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramAccount_igUserId_key" ON "InstagramAccount"("igUserId");

-- CreateIndex
CREATE INDEX "InstagramPost_tenantId_postedAt_idx" ON "InstagramPost"("tenantId", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramPost_tenantId_igMediaId_key" ON "InstagramPost"("tenantId", "igMediaId");

-- CreateIndex
CREATE INDEX "VoiceCard_tenantId_source_generatedAt_idx" ON "VoiceCard"("tenantId", "source", "generatedAt");

-- AddForeignKey
ALTER TABLE "InstagramAccount" ADD CONSTRAINT "InstagramAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "IntegrationTenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramPost" ADD CONSTRAINT "InstagramPost_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "IntegrationTenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceCard" ADD CONSTRAINT "VoiceCard_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "IntegrationTenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
