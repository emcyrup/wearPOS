import { NextResponse } from "next/server";
import { z } from "zod";

import { endOfDay, startOfDay } from "@/lib/analytics";
import { getSessionUser } from "@/lib/auth";
import { buildInsightData } from "@/lib/insights";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * AI考察で外部 (Anthropic / OpenAI) へ送るデータそのものを返す。
 * 「何が送られているか」を画面でそのまま確認できるようにするための API。
 * 送信内容と完全に同じものを返すため、対応表 (スタッフの実名) は含めない。
 *
 * GET /api/insights/preview?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "期間の指定が不正です" }, { status: 400 });
  }

  const range = {
    from: startOfDay(new Date(`${parsed.data.from}T00:00:00`)),
    to: endOfDay(new Date(`${parsed.data.to}T00:00:00`)),
  };
  if (Number.isNaN(range.from.getTime()) || Number.isNaN(range.to.getTime()) || range.from > range.to) {
    return NextResponse.json({ error: "期間の指定が不正です" }, { status: 400 });
  }

  const { data } = await buildInsightData(range);
  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
}
