-- CreateTable
CREATE TABLE "LineRegistration" (
    "lineUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LineRegistration_pkey" PRIMARY KEY ("lineUserId")
);
