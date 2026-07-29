import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL が設定されていません。.env またはホスティング側の環境変数を確認してください。",
    );
  }

  // サーバーレス環境ではインスタンスごとに接続が作られるため、
  // 1インスタンスあたりの接続数を絞り、アイドル接続を短時間で解放する。
  // Neon などのプール付き接続文字列 (-pooler) と併用する前提。
  const adapter = new PrismaPg({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

  return new PrismaClient({ adapter });
}

function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient();
  }
  return globalForPrisma.prisma;
}

/**
 * 接続はモジュール読み込み時ではなく、最初に使われた時点で作る。
 * こうしておくと DATABASE_URL の無いビルド環境でも `next build` が通る。
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = getClient();
    const value = Reflect.get(client, property, receiver);
    // $transaction などが内部で this を使うため、クライアントに束縛して返す
    return typeof value === "function" ? value.bind(client) : value;
  },
});
