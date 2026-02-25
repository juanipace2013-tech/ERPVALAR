-- AlterEnum
ALTER TYPE "QuoteStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "QuoteStatus" ADD VALUE 'CONVERTED';

-- CreateEnum
CREATE TYPE "DeliveryNoteStatus" AS ENUM ('PENDING', 'PREPARING', 'READY', 'DISPATCHED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AfipStatus" AS ENUM ('PENDING', 'SENT', 'APPROVED', 'REJECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "InvoicePaymentStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID');

-- AlterTable Quote - Add new workflow fields
ALTER TABLE "quotes" ADD COLUMN "statusUpdatedAt" TIMESTAMP(3);
ALTER TABLE "quotes" ADD COLUMN "statusUpdatedBy" TEXT;
ALTER TABLE "quotes" ADD COLUMN "customerResponse" TEXT;
ALTER TABLE "quotes" ADD COLUMN "responseDate" TIMESTAMP(3);
ALTER TABLE "quotes" ADD COLUMN "rejectionReason" TEXT;
ALTER TABLE "quotes" ADD COLUMN "internalNotes" TEXT;

-- CreateTable QuoteStatusHistory
CREATE TABLE "quote_status_history" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "fromStatus" "QuoteStatus" NOT NULL,
    "toStatus" "QuoteStatus" NOT NULL,
    "changedBy" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable DeliveryNote
CREATE TABLE "delivery_notes" (
    "id" TEXT NOT NULL,
    "deliveryNumber" TEXT NOT NULL,
    "quoteId" TEXT,
    "customerId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveryDate" TIMESTAMP(3),
    "deliveryAddress" TEXT,
    "deliveryCity" TEXT,
    "deliveryProvince" TEXT,
    "deliveryPostalCode" TEXT,
    "status" "DeliveryNoteStatus" NOT NULL DEFAULT 'PENDING',
    "carrier" TEXT,
    "trackingNumber" TEXT,
    "preparedBy" TEXT,
    "deliveredBy" TEXT,
    "receivedBy" TEXT,
    "notes" TEXT,
    "internalNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable DeliveryNoteItem
CREATE TABLE "delivery_note_items" (
    "id" TEXT NOT NULL,
    "deliveryNoteId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "warehouseLocation" TEXT,
    "batchNumber" TEXT,
    "serialNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_note_items_pkey" PRIMARY KEY ("id")
);

-- AlterTable Invoice - Add new fields
ALTER TABLE "invoices" ADD COLUMN "deliveryNoteId" TEXT;
ALTER TABLE "invoices" ADD COLUMN "afipStatus" "AfipStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "invoices" ADD COLUMN "afipError" TEXT;
ALTER TABLE "invoices" ADD COLUMN "paymentStatus" "InvoicePaymentStatus" NOT NULL DEFAULT 'UNPAID';
ALTER TABLE "invoices" ALTER COLUMN "quoteId" DROP NOT NULL;
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_quoteId_key";

-- CreateIndex
CREATE INDEX "quote_status_history_quoteId_idx" ON "quote_status_history"("quoteId");
CREATE INDEX "quote_status_history_createdAt_idx" ON "quote_status_history"("createdAt");
CREATE INDEX "quotes_validUntil_idx" ON "quotes"("validUntil");

CREATE UNIQUE INDEX "delivery_notes_deliveryNumber_key" ON "delivery_notes"("deliveryNumber");
CREATE INDEX "delivery_notes_customerId_idx" ON "delivery_notes"("customerId");
CREATE INDEX "delivery_notes_quoteId_idx" ON "delivery_notes"("quoteId");
CREATE INDEX "delivery_notes_status_idx" ON "delivery_notes"("status");
CREATE INDEX "delivery_notes_date_idx" ON "delivery_notes"("date");

CREATE INDEX "delivery_note_items_deliveryNoteId_idx" ON "delivery_note_items"("deliveryNoteId");
CREATE INDEX "delivery_note_items_productId_idx" ON "delivery_note_items"("productId");

CREATE INDEX "invoices_quoteId_idx" ON "invoices"("quoteId");
CREATE INDEX "invoices_deliveryNoteId_idx" ON "invoices"("deliveryNoteId");
CREATE INDEX "invoices_afipStatus_idx" ON "invoices"("afipStatus");
CREATE INDEX "invoices_paymentStatus_idx" ON "invoices"("paymentStatus");

-- AddForeignKey
ALTER TABLE "quote_status_history" ADD CONSTRAINT "quote_status_history_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "delivery_note_items" ADD CONSTRAINT "delivery_note_items_deliveryNoteId_fkey" FOREIGN KEY ("deliveryNoteId") REFERENCES "delivery_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "delivery_note_items" ADD CONSTRAINT "delivery_note_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_deliveryNoteId_fkey" FOREIGN KEY ("deliveryNoteId") REFERENCES "delivery_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
