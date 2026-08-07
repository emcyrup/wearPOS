-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "reminderDisabledKeys" TEXT[] DEFAULT ARRAY[]::TEXT[];
