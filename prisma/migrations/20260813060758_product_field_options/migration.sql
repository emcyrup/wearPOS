-- AlterTable
ALTER TABLE "ProductField" ADD COLUMN     "options" TEXT[] DEFAULT ARRAY[]::TEXT[];
