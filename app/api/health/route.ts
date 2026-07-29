import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * 表示が遅いときの切り分け用。
 *
 *   GET /api/health
 *
 * 「どの画面も一様に遅い」場合、原因は画面の処理量ではなく
 * リクエストごとの固定コストにある。ここではその内訳を返す。
 *
 * - instanceAgeMs が毎回小さい  -> 実行環境が毎回作り直されている (コールドスタート)
 * - dbPingMs が初回だけ大きい   -> データベースが停止状態から復帰している
 * - dbPingMs が常に大きい       -> アプリとデータベースの距離、または接続の張り直し
 */

/** この実行環境が起動してからの経過時間。使い回されていれば増えていく */
const bootedAt = Date.now();
let requestCount = 0;

export async function GET() {
  requestCount += 1;
  const startedAt = Date.now();

  // 接続の確立と往復にかかる時間 (最小のクエリ)
  const pingStart = Date.now();
  let dbPingMs: number | null = null;
  let dbError: string | null = null;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbPingMs = Date.now() - pingStart;
  } catch (error) {
    dbError = error instanceof Error ? error.message : String(error);
  }

  // 実際の画面で使う集計クエリ1本ぶんの時間
  const queryStart = Date.now();
  let dbQueryMs: number | null = null;
  try {
    await prisma.sale.count();
    dbQueryMs = Date.now() - queryStart;
  } catch {
    // ping 側で理由は取れているので握りつぶす
  }

  return NextResponse.json(
    {
      /** この実行環境が生きている時間。毎回 0 に近ければコールドスタート */
      instanceAgeMs: Date.now() - bootedAt,
      /** この実行環境が処理したリクエスト数。毎回 1 ならコールドスタート */
      requestsServedByThisInstance: requestCount,
      /** データベースとの往復時間 */
      dbPingMs,
      /** 集計クエリ1本の実行時間 */
      dbQueryMs,
      /** サーバー側の処理時間の合計 */
      totalServerMs: Date.now() - startedAt,
      region: process.env.VERCEL_REGION ?? "(ローカル)",
      dbError,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
