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
  // 1インスタンスあたりの接続数は絞る。
  // 一方でアイドル接続を早く切ると、アクセスのたびに TCP・TLS・認証の
  // ハンドシェイクをやり直すことになり、そのぶん表示が遅くなる。
  // 実行環境が生きている間は接続を使い回せるよう、待機時間は長めにとる。
  const adapter = new PrismaPg({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS ?? 120_000),
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
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
