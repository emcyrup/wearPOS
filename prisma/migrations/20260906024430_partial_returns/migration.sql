-- AlterTable
ALTER TABLE "SaleLine" ADD COLUMN     "originalLineId" TEXT;

-- CreateIndex
CREATE INDEX "Sale_originalSaleId_idx" ON "Sale"("originalSaleId");

-- CreateIndex
CREATE INDEX "SaleLine_originalLineId_idx" ON "SaleLine"("originalLineId");

-- 既存の返品伝票 (externalId = 'RETURN-<元伝票ID>') に返品元を紐づける。
-- これまでの返品はすべて伝票まるごとの返品だったため、明細の originalLineId は NULL のままとし、
-- アプリ側では「全明細を返品済み」として扱う。
UPDATE "Sale"
SET "originalSaleId" = substring("externalId" from 8)
WHERE "type" = 'RETURN'
  AND "originalSaleId" IS NULL
  AND "externalId" LIKE 'RETURN-%';
