-- DropForeignKey
ALTER TABLE "SaleLine" DROP CONSTRAINT "SaleLine_variantId_fkey";

-- AlterTable
ALTER TABLE "SaleLine" ALTER COLUMN "variantId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
