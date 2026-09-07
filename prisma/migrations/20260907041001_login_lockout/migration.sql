-- ログインの総当たり対策。連続失敗の回数と、一時的なロック期限を持つ
ALTER TABLE "AppUser" ADD COLUMN     "failedLogins" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3);
