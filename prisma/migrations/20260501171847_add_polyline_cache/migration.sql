-- CreateTable
CREATE TABLE "LdSimPolylineCache" (
    "id" SERIAL NOT NULL,
    "routeKey" TEXT NOT NULL,
    "polyline" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LdSimPolylineCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LdSimPolylineCache_routeKey_key" ON "LdSimPolylineCache"("routeKey");
