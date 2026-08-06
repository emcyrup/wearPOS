import { NextResponse } from "next/server";

import { authorizePosRequest } from "@/lib/api-auth";
import {
  ingestPosSale,
  posSaleSchema,
  SaleIngestError,
  sendPurchaseLineNotification,
} from "@/lib/sales";

export const dynamic = "force-dynamic";

/**
 * POS レジからの取引取り込み。
 *
 * POST /api/pos/sales
 * Header: X-API-Key: <POS_API_KEY>
 * Body: PosSale (単体) または { sales: PosSale[] } (一括)
 *
 * externalId で冪等性を担保するため、通信エラー時はそのまま再送してよい。
 */
export async function POST(request: Request) {
  const unauthorized = authorizePosRequest(request);
  if (unauthorized) return unauthorized;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON の解析に失敗しました" }, { status: 400 });
  }

  const batch =
    payload && typeof payload === "object" && "sales" in payload
      ? (payload as { sales: unknown[] }).sales
      : [payload];

  if (!Array.isArray(batch) || batch.length === 0) {
    return NextResponse.json({ error: "取引データが空です" }, { status: 400 });
  }
  if (batch.length > 200) {
    return NextResponse.json({ error: "一度に送信できる取引は 200 件までです" }, { status: 413 });
  }

  const results: unknown[] = [];
  const errors: { index: number; error: string }[] = [];

  for (const [index, item] of batch.entries()) {
    const parsed = posSaleSchema.safeParse(item);
    if (!parsed.success) {
      errors.push({
        index,
        error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "),
      });
      continue;
    }

    try {
      const result = await ingestPosSale(parsed.data);

      // 会員かつ LINE 連携済みなら購入通知を送る
      await sendPurchaseLineNotification(result);

      results.push({
        externalId: parsed.data.externalId,
        saleId: result.saleId,
        receiptNo: result.receiptNo,
        duplicated: result.duplicated,
        pointsEarned: result.pointsEarned,
        customerId: result.customerId,
      });
    } catch (error) {
      if (error instanceof SaleIngestError) {
        errors.push({ index, error: error.message });
      } else {
        console.error("取引の取り込みに失敗しました", error);
        errors.push({ index, error: "内部エラーにより取り込めませんでした" });
      }
    }
  }

  // 1 件でも成功していれば 200、全滅なら 400 を返す
  const status = results.length > 0 ? 200 : 400;
  return NextResponse.json(
    { accepted: results.length, rejected: errors.length, results, errors },
    { status },
  );
}
