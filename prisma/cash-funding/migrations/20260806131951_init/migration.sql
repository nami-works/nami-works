-- CreateEnum
CREATE TYPE "FunderType" AS ENUM ('bank', 'fidc');

-- CreateEnum
CREATE TYPE "PaymentCalendar" AS ENUM ('corrido', 'terca_3_25');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('planned', 'invoiced', 'received');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('open', 'planned', 'operated');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "googleSub" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Funder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FunderType" NOT NULL,
    "taxaAmPct" DECIMAL(8,5) NOT NULL,
    "iofDiarioPct" DECIMAL(8,6) NOT NULL,
    "iofFixoPct" DECIMAL(8,5) NOT NULL,
    "tarifaOperacao" DECIMAL(12,2) NOT NULL,
    "tarifaTitulo" DECIMAL(12,2) NOT NULL,
    "tenorMaxDias" INTEGER NOT NULL,
    "tetoLinha" DECIMAL(14,2) NOT NULL,
    "perSacadoCap" DECIMAL(14,2),
    "recourse" BOOLEAN NOT NULL DEFAULT true,
    "costsConfirmed" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Funder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "cliente" TEXT NOT NULL,
    "cnpjSacado" TEXT NOT NULL,
    "produto" TEXT NOT NULL,
    "qtd" INTEGER NOT NULL,
    "precoUnit" DECIMAL(12,4) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "numParcelas" INTEGER NOT NULL,
    "firstOffsetDias" INTEGER NOT NULL,
    "intervalDias" INTEGER NOT NULL,
    "calendar" "PaymentCalendar" NOT NULL,
    "dataEntrega" DATE NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'planned',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Installment" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "valorFace" DECIMAL(14,2) NOT NULL,
    "dataVencimento" DATE NOT NULL,
    "dataDesconto" DATE,
    "funderId" TEXT,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'open',
    "operationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Installment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Operation" (
    "id" TEXT NOT NULL,
    "funderId" TEXT NOT NULL,
    "opNumero" TEXT,
    "dataOperacao" DATE NOT NULL,
    "faceTotal" DECIMAL(14,2) NOT NULL,
    "juros" DECIMAL(14,2) NOT NULL,
    "iof" DECIMAL(14,2) NOT NULL,
    "tarifas" DECIMAL(14,2) NOT NULL,
    "custoTotal" DECIMAL(14,2) NOT NULL,
    "liquido" DECIMAL(14,2) NOT NULL,
    "dataVencimentoFinal" DATE NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Operation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Funder_name_key" ON "Funder"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Installment_deliveryId_numero_key" ON "Installment"("deliveryId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "Operation_opNumero_key" ON "Operation"("opNumero");

-- AddForeignKey
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_funderId_fkey" FOREIGN KEY ("funderId") REFERENCES "Funder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_funderId_fkey" FOREIGN KEY ("funderId") REFERENCES "Funder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
