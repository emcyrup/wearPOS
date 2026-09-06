"use server";

import { revalidatePath } from "next/cache";

import { rankForSpent } from "@/lib/apparel";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { applyStockMovement } from "@/lib/inventory";
import { activePaymentMethods } from "@/lib/payment-methods";
import {
  calcReturnAmounts,
  refundByOriginalPayments,
  type RefundPayment,
  type ReturnLineInput,
} from "@/lib/return-calc";
import { summarizeReturns } from "@/lib/returns";

export type ReturnSaleResult = { ok: true; returnSaleId: string } | { ok: false; error: string };

export type ReturnSaleInput = {
  saleId: string;
  /** 返品する明細と点数。省略すると返品できるものをすべて返す (伝票まるごとの返品) */
  lines?: ReturnLineInput[];
  /**
   * 返金の内訳。省略すると元伝票の支払内訳どおりに按分して返す。
   * 合計は「返金額 - 返還ポイント」と一致していること。
   */
  refunds?: RefundPayment[];
};

/**
 * 取引を返品する。明細ごとの点数を指定した一部返品にも対応する。
 * - 返品伝票 (type=RETURN) を新規作成し、元伝票は書き換えない
 * - 在庫を返品ぶん戻し入れる (手入力商品は在庫を持たないため対象外)
 * - 会員は 利用ポイントの返還 / 獲得ポイントの取消 / 累計購入額・ランク を返品ぶん巻き戻す
 *   (来店回数は、伝票のすべてを返品したときだけ 1 減らす)
 * - 返金の内訳は元の支払い方法どおり、または指定した支払方法へ振り分けられる
 */
export async function returnSale(input: ReturnSaleInput): Promise<ReturnSaleResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "ログインが必要です" };

  const sale = await prisma.sale.findUnique({
    where: { id: input.saleId },
    include: {
      lines: { include: { variant: { include: { product: true } } } },
      payments: true,
    },
  });
  if (!sale) return { ok: false, error: "取引が見つかりません" };
  if (sale.type !== "SALE") return { ok: false, error: "返品伝票はさらに返品できません" };

  const summary = await summarizeReturns(sale);
  if (!summary.hasReturnable) return { ok: false, error: "この取引はすべて返品済みです" };

  // 明細の指定がなければ、返せるものをすべて返す
  const requested: ReturnLineInput[] =
    input.lines && input.lines.length > 0
      ? input.lines
      : summary.lines
          .filter((line) => line.returnableQuantity > 0)
          .map((line) => ({ lineId: line.lineId, quantity: line.returnableQuantity }));

  const calculated = calcReturnAmounts(sale, summary, requested);
  // sale は Prisma のレコードだが、必要な金額フィールド (subtotal/discount/tax/total/points) は
  // SaleTotals と同じ形なのでそのまま渡している
  if (!calculated.ok) return { ok: false, error: calculated.error };
  const amounts = calculated.amounts;

  // 返金の内訳。指定がなければ元の支払い方法どおりに按分する
  let refunds =
    input.refunds && input.refunds.length > 0
      ? input.refunds.filter((refund) => refund.amount > 0)
      : refundByOriginalPayments(
          sale.payments.slice().sort((a, b) => a.sortOrder - b.sortOrder),
          sale.paymentMethod,
          amounts.refundNet,
        );

  if (input.refunds && input.refunds.length > 0) {
    const methods = await activePaymentMethods();
    for (const refund of refunds) {
      if (!Number.isInteger(refund.amount) || refund.amount < 0) {
        return { ok: false, error: "返金額が不正です" };
      }
      if (!methods.find((row) => row.code === refund.method)) {
        return { ok: false, error: "この支払方法は使えません。画面を再読み込みしてください。" };
      }
    }
    const refundTotal = refunds.reduce((sum, refund) => sum + refund.amount, 0);
    if (refundTotal !== amounts.refundNet) {
      return {
        ok: false,
        error: `返金の内訳 (${refundTotal.toLocaleString()}円) が返金額 (${amounts.refundNet.toLocaleString()}円) と一致しません`,
      };
    }
  }
  if (refunds.length === 0 && amounts.refundNet > 0) {
    refunds = [{ method: sale.paymentMethod, amount: amounts.refundNet }];
  }

  // 1伝票に複数回の返品ができるため、2回目以降は連番を付ける
  const seq = summary.returned.count + 1;
  const externalId = seq === 1 ? `RETURN-${sale.id}` : `RETURN-${sale.id}-${seq}`;
  const receiptNo = seq === 1 ? `${sale.receiptNo}-R` : `${sale.receiptNo}-R${seq}`;
  const returnedCount = amounts.lines.reduce((sum, line) => sum + line.quantity, 0);

  let returnSaleId: string;
  try {
    const created = await prisma.$transaction(async (tx) => {
      const returned = await tx.sale.create({
        data: {
          receiptNo,
          externalId,
          source: sale.source,
          storeId: sale.storeId,
          staffId: sale.staffId,
          customerId: sale.customerId,
          originalSaleId: sale.id,
          soldAt: new Date(),
          subtotal: amounts.subtotal,
          discount: amounts.discount,
          tax: amounts.tax,
          total: amounts.total,
          pointsUsed: 0,
          pointsEarned: 0,
          paymentMethod:
            refunds.reduce(
              (max, refund) => (refund.amount > max.amount ? refund : max),
              refunds[0] ?? { method: sale.paymentMethod, amount: 0 },
            ).method ?? sale.paymentMethod,
          type: "RETURN",
          note: amounts.isFinal
            ? `伝票 ${sale.receiptNo} の返品`
            : `伝票 ${sale.receiptNo} の一部返品 (${returnedCount}点)`,
          // 支払方法別の集計から正しく差し引けるよう、返金の内訳を持たせる
          payments: {
            create: refunds.map((refund, index) => ({
              method: refund.method,
              amount: refund.amount,
              note: refund.note ?? null,
              sortOrder: index,
            })),
          },
          lines: {
            create: amounts.lines.map((line) => ({
              variantId: line.variantId,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discount: line.discount,
              lineTotal: line.lineTotal,
              listPriceAtSale: line.listPriceAtSale,
              note: line.note,
              originalLineId: line.lineId,
            })),
          },
        },
      });

      // 在庫の戻し入れ
      for (const line of amounts.lines) {
        if (!line.variantId) continue;
        await applyStockMovement(tx, {
          storeId: sale.storeId,
          variantId: line.variantId,
          type: "RETURN",
          quantity: Math.abs(line.quantity),
          refType: "SALE",
          refId: returned.id,
          staffId: sale.staffId,
          reason: `返品による戻し入れ (${sale.receiptNo})`,
        });
      }

      // 会員のポイント・実績の巻き戻し
      if (sale.customerId) {
        const customer = await tx.customer.findUnique({ where: { id: sale.customerId } });
        if (customer) {
          let balance = customer.points;

          // 会計時に使ったポイントを返す
          if (amounts.pointsRefunded > 0) {
            balance += amounts.pointsRefunded;
            await tx.pointEvent.create({
              data: {
                customerId: customer.id,
                type: "ADJUST",
                points: amounts.pointsRefunded,
                balance,
                saleId: returned.id,
                note: `${sale.receiptNo} 返品による利用ポイントの返還`,
              },
            });
          }

          // 会計で付与したポイントを取り消す (残高不足の場合は残高ぶんまで)
          if (amounts.pointsRevoked > 0) {
            const revoke = Math.min(amounts.pointsRevoked, balance);
            if (revoke > 0) {
              balance -= revoke;
              await tx.pointEvent.create({
                data: {
                  customerId: customer.id,
                  type: "ADJUST",
                  points: -revoke,
                  balance,
                  saleId: returned.id,
                  note:
                    revoke === amounts.pointsRevoked
                      ? `${sale.receiptNo} 返品による獲得ポイントの取消`
                      : `${sale.receiptNo} 返品による獲得ポイントの取消 (残高不足のため ${revoke} pt のみ)`,
                },
              });
            }
          }

          const totalSpent = Math.max(0, customer.totalSpent - amounts.total);
          await tx.customer.update({
            where: { id: customer.id },
            data: {
              points: balance,
              totalSpent,
              rank: rankForSpent(totalSpent),
              // 来店そのものが無くなるのは、伝票をすべて返品したときだけ
              visitCount: amounts.isFinal
                ? Math.max(0, customer.visitCount - 1)
                : customer.visitCount,
            },
          });
        }
      }

      return returned;
    });
    returnSaleId = created.id;
  } catch (error) {
    // externalId / receiptNo の一意制約に当たった場合は同時実行による二重返品
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return { ok: false, error: "この取引はすでに返品処理されています。画面を再読み込みしてください。" };
    }
    console.error("返品処理に失敗しました", error);
    return { ok: false, error: "返品処理に失敗しました。時間をおいて再度お試しください" };
  }

  revalidatePath(`/sales/${sale.id}`);
  revalidatePath("/sales");
  revalidatePath("/inventory");
  if (sale.customerId) revalidatePath(`/customers/${sale.customerId}`);

  return { ok: true, returnSaleId };
}
