"use server";

import { revalidatePath } from "next/cache";

import { rankForSpent } from "@/lib/apparel";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { applyStockMovement } from "@/lib/inventory";

export type ReturnSaleResult =
  | { ok: true; returnSaleId: string }
  | { ok: false; error: string };

/**
 * 取引をまるごと返品 (取消) する。
 * - 返品伝票 (type=RETURN) を新規作成し、元伝票は書き換えない
 * - 在庫を明細ぶん戻し入れる (手入力商品は在庫を持たないため対象外)
 * - 会員は 利用ポイントの返還 / 獲得ポイントの取消 / 累計購入額・ランク・来店回数 を巻き戻す
 * - externalId `RETURN-<元伝票ID>` を冪等キーとし、二重返品を防ぐ
 */
export async function returnSale(saleId: string): Promise<ReturnSaleResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "ログインが必要です" };

  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    include: { lines: true, payments: { orderBy: { sortOrder: "asc" } } },
  });
  if (!sale) return { ok: false, error: "取引が見つかりません" };
  if (sale.type !== "SALE") return { ok: false, error: "返品伝票はさらに返品できません" };

  const externalId = `RETURN-${sale.id}`;
  const existing = await prisma.sale.findUnique({ where: { externalId } });
  if (existing) return { ok: false, error: "この取引は返品済みです" };

  let returnSaleId: string;
  try {
    const created = await prisma.$transaction(async (tx) => {
      const returned = await tx.sale.create({
        data: {
          receiptNo: `${sale.receiptNo}-R`,
          externalId,
          source: sale.source,
          storeId: sale.storeId,
          staffId: sale.staffId,
          customerId: sale.customerId,
          soldAt: new Date(),
          subtotal: sale.subtotal,
          discount: sale.discount,
          tax: sale.tax,
          total: sale.total,
          pointsUsed: 0,
          pointsEarned: 0,
          paymentMethod: sale.paymentMethod,
          type: "RETURN",
          note: `伝票 ${sale.receiptNo} の返品`,
          // 支払方法別の集計から正しく差し引けるよう、元伝票の内訳をそのまま引き継ぐ
          payments: {
            create: sale.payments.map((payment) => ({
              method: payment.method,
              amount: payment.amount,
              sortOrder: payment.sortOrder,
            })),
          },
          lines: {
            create: sale.lines.map((line) => ({
              variantId: line.variantId,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discount: line.discount,
              lineTotal: line.lineTotal,
              listPriceAtSale: line.listPriceAtSale,
              note: line.note,
            })),
          },
        },
      });

      // 在庫の戻し入れ
      for (const line of sale.lines) {
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
          if (sale.pointsUsed > 0) {
            balance += sale.pointsUsed;
            await tx.pointEvent.create({
              data: {
                customerId: customer.id,
                type: "ADJUST",
                points: sale.pointsUsed,
                balance,
                saleId: returned.id,
                note: `${sale.receiptNo} 返品による利用ポイントの返還`,
              },
            });
          }

          // 会計で付与したポイントを取り消す (残高不足の場合は残高ぶんまで)
          if (sale.pointsEarned > 0) {
            const revoke = Math.min(sale.pointsEarned, balance);
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
                    revoke === sale.pointsEarned
                      ? `${sale.receiptNo} 返品による獲得ポイントの取消`
                      : `${sale.receiptNo} 返品による獲得ポイントの取消 (残高不足のため ${revoke} pt のみ)`,
                },
              });
            }
          }

          const totalSpent = Math.max(0, customer.totalSpent - sale.total);
          await tx.customer.update({
            where: { id: customer.id },
            data: {
              points: balance,
              totalSpent,
              rank: rankForSpent(totalSpent),
              visitCount: Math.max(0, customer.visitCount - 1),
            },
          });
        }
      }

      return returned;
    });
    returnSaleId = created.id;
  } catch (error) {
    // externalId の一意制約に当たった場合は同時実行による二重返品
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return { ok: false, error: "この取引は返品済みです" };
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
