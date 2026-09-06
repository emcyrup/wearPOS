import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { ReturnableLine, ReturnedTotals } from "@/lib/return-calc";

/**
 * 返品の集計 (DB アクセスを伴う部分)。
 * 金額そのものの計算は `lib/return-calc.ts` にある純粋な関数を使う。
 *
 * 1つの売上伝票に対して返品伝票を複数作れるため、「どの明細を何点まで返せるか」は
 * 過去の返品伝票を積み上げて判定する。
 */

export type ReturnSummary = {
  lines: ReturnableLine[];
  returned: ReturnedTotals;
  /** 返品できる明細が残っているか */
  hasReturnable: boolean;
};

export type SaleForReturn = Prisma.SaleGetPayload<{
  include: {
    lines: { include: { variant: { include: { product: true } } } };
    payments: true;
  };
}>;

/**
 * 元伝票に対する返品状況を集計する。
 * 明細ごとの返品可能点数と、これまでの返品累計を返す。
 */
export async function summarizeReturns(sale: SaleForReturn): Promise<ReturnSummary> {
  const returns = await prisma.sale.findMany({
    where: { originalSaleId: sale.id, type: "RETURN" },
    include: { lines: true, pointEvents: true },
  });

  const returnedByLine = new Map<string, number>();
  const returnedAmountByLine = new Map<string, number>();
  let legacyFullReturn = false;

  for (const slip of returns) {
    for (const line of slip.lines) {
      if (!line.originalLineId) {
        // 旧データ (明細単位の返品が無かった頃) は伝票まるごとの返品
        legacyFullReturn = true;
        continue;
      }
      returnedByLine.set(
        line.originalLineId,
        (returnedByLine.get(line.originalLineId) ?? 0) + line.quantity,
      );
      returnedAmountByLine.set(
        line.originalLineId,
        (returnedAmountByLine.get(line.originalLineId) ?? 0) + line.lineTotal,
      );
    }
  }

  const returned: ReturnedTotals = {
    subtotal: returns.reduce((sum, slip) => sum + slip.subtotal, 0),
    discount: returns.reduce((sum, slip) => sum + slip.discount, 0),
    tax: returns.reduce((sum, slip) => sum + slip.tax, 0),
    total: returns.reduce((sum, slip) => sum + slip.total, 0),
    // ポイントの増減は PointEvent に残している (プラス = 利用ポイントの返還)
    pointsRefunded: returns.reduce(
      (sum, slip) =>
        sum + slip.pointEvents.filter((e) => e.points > 0).reduce((s, e) => s + e.points, 0),
      0,
    ),
    pointsRevoked: returns.reduce(
      (sum, slip) =>
        sum + slip.pointEvents.filter((e) => e.points < 0).reduce((s, e) => s - e.points, 0),
      0,
    ),
    count: returns.length,
    legacyFullReturn,
  };

  const lines: ReturnableLine[] = sale.lines.map((line) => {
    const returnedQuantity = legacyFullReturn
      ? line.quantity
      : Math.min(line.quantity, returnedByLine.get(line.id) ?? 0);
    const returnedAmount = legacyFullReturn
      ? line.lineTotal
      : (returnedAmountByLine.get(line.id) ?? 0);
    return {
      lineId: line.id,
      name: line.variant?.product.name ?? line.note ?? "手入力商品",
      sku: line.variant?.sku ?? null,
      colorName: line.variant?.colorName ?? null,
      sizeName: line.variant?.sizeName ?? null,
      variantId: line.variantId,
      note: line.note,
      taxRate: line.variant?.product.taxRate ?? 0.1,
      quantity: line.quantity,
      returnedQuantity,
      returnableQuantity: Math.max(0, line.quantity - returnedQuantity),
      unitPrice: line.unitPrice,
      discount: line.discount,
      lineTotal: line.lineTotal,
      listPriceAtSale: line.listPriceAtSale,
      remainingLineTotal: Math.max(0, line.lineTotal - returnedAmount),
    };
  });

  return {
    lines,
    returned,
    hasReturnable: lines.some((line) => line.returnableQuantity > 0),
  };
}
