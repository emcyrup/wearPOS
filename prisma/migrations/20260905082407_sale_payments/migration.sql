-- CreateTable
CREATE TABLE "SalePayment" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "tendered" INTEGER,
    "change" INTEGER,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SalePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalePayment_saleId_idx" ON "SalePayment"("saleId");

-- CreateIndex
CREATE INDEX "SalePayment_method_idx" ON "SalePayment"("method");

-- AddForeignKey
ALTER TABLE "SalePayment" ADD CONSTRAINT "SalePayment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 既存の伝票にも支払明細を1行ずつ作る (支払方法別の集計を明細ベースへ移行するため)。
-- 金額はポイント利用を差し引いた実際の支払額。
INSERT INTO "SalePayment" ("id", "saleId", "method", "amount", "sortOrder")
SELECT
  'seed_' || s."id",
  s."id",
  s."paymentMethod",
  GREATEST(0, s."total" - s."pointsUsed"),
  0
FROM "Sale" s;
