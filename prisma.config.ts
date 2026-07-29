import "dotenv/config";
import path from "node:path";
import { defineConfig } from "prisma/config";

/**
 * マイグレーションの接続先。
 *
 * Neon などのサーバーレス Postgres では、アプリはコネクションプール経由 (-pooler) で
 * 接続する一方、マイグレーションはプールを介さない直結の接続文字列を使う必要がある。
 * DIRECT_DATABASE_URL があればそちらを優先する。
 */
const migrationUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;

if (!migrationUrl) {
  throw new Error("DATABASE_URL (または DIRECT_DATABASE_URL) が設定されていません");
}

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  datasource: {
    url: migrationUrl,
  },
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
