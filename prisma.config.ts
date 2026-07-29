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

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  // `prisma generate` のように接続を必要としないコマンドもあるため、
  // URL が無い場合は datasource ごと渡さない。
  // これがないと .env の無いクローン直後に postinstall が失敗する。
  ...(migrationUrl ? { datasource: { url: migrationUrl } } : {}),
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
