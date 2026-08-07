import { NextResponse } from "next/server";

import { runReminders } from "@/lib/reminders";

export const dynamic = "force-dynamic";
// 対象人数によっては時間がかかる
export const maxDuration = 300;

/**
 * LINE 自動リマインドの実行エンドポイント。
 * Vercel Cron (vercel.json の crons) から毎日 10:00 JST に呼ばれる。
 *
 * GET /api/reminders/run
 * 認証: Authorization: Bearer <CRON_SECRET> (Vercel Cron が自動で付与)
 *       または X-API-Key: <POS_API_KEY> (手動実行・他システム連携用)
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const posKey = process.env.POS_API_KEY;

  const bearer = request.headers.get("authorization");
  const apiKey = request.headers.get("x-api-key");

  const authorized =
    (cronSecret && bearer === `Bearer ${cronSecret}`) || (posKey && apiKey === posKey);

  if (!authorized) {
    return NextResponse.json({ error: "認証に失敗しました" }, { status: 401 });
  }

  const results = await runReminders();
  return NextResponse.json({
    ranAt: new Date().toISOString(),
    results,
  });
}
