-- CreateTable
CREATE TABLE "ProductField" (
    "id" TEXT NOT NULL,
    "builtinKey" TEXT,
    "label" TEXT NOT NULL,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductFieldValue" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "ProductFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductField_builtinKey_key" ON "ProductField"("builtinKey");

-- CreateIndex
CREATE INDEX "ProductFieldValue_fieldId_idx" ON "ProductFieldValue"("fieldId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductFieldValue_productId_fieldId_key" ON "ProductFieldValue"("productId", "fieldId");

-- AddForeignKey
ALTER TABLE "ProductFieldValue" ADD CONSTRAINT "ProductFieldValue_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductFieldValue" ADD CONSTRAINT "ProductFieldValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "ProductField"("id") ON DELETE CASCADE ON UPDATE CASCADE;
