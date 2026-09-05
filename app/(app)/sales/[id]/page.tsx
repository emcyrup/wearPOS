import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge, Card, PageHeader, Table } from "@/components/ui";
import { ReceiptWindowButton } from "@/components/print-button";
import { ReturnSaleButton } from "@/components/return-sale-button";
import { markdownRate, PAYMENT_METHOD_LABEL, rankLabel } from "@/lib/apparel";
import { MULTI_STORE } from "@/lib/config";
import { prisma } from "@/lib/db";
import { formatDateTime, formatPercent, formatYen, fullName } from "@/lib/format";
import { paymentMethodLabels } from "@/lib/payment-methods";

export const dynamic = "force-dynamic";

export default async function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      store: true,
      staff: true,
      customer: true,
      pointEvents: true,
      payments: { orderBy: { sortOrder: "asc" } },
      lines: {
        include: { variant: { include: { product: { include: { season: true, brand: true } } } } },
      },
    },
  });

  if (!sale) notFound();

  // 支払方法の表示名は設定のマスタから引く (追加された支払方法にも対応)
  const paymentLabels = await paymentMethodLabels();


  const itemCount = sale.lines.reduce((sum, line) => sum + line.quantity, 0);

  // 返品状態: この伝票に対する返品伝票 (externalId=RETURN-<id>) があるか
  const returnRecord =
    sale.type === "SALE"
      ? await prisma.sale.findUnique({
          where: { externalId: `RETURN-${sale.id}` },
          select: { id: true, receiptNo: true, soldAt: true },
        })
      : null;
  // 返品伝票の場合は元伝票へのリンクを出す
  const originalSaleId =
    sale.type === "RETURN" && sale.externalId?.startsWith("RETURN-")
      ? sale.externalId.slice("RETURN-".length)
      : null;

  return (
    <>
      <div className="mb-2">
        <Link href="/sales" className="text-sm text-ink-400 hover:text-ink-600">
          ← 取引履歴
        </Link>
      </div>

      <PageHeader
        title={sale.receiptNo}
        description={`${formatDateTime(sale.soldAt)}${MULTI_STORE ? ` · ${sale.store.name}` : ""}${
          sale.staff ? ` · ${sale.staff.name}` : ""
        }`}
        action={
          // スマートフォンではバッジとボタンを折り返す
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={sale.type === "RETURN" ? "danger" : "success"}>
              {sale.type === "RETURN" ? "返品" : "販売"}
            </Badge>
            {returnRecord && <Badge tone="danger">返品済み</Badge>}
            <Badge tone="neutral">{sale.source}</Badge>
            {sale.type === "SALE" && !returnRecord && (
              <ReturnSaleButton saleId={sale.id} receiptNo={sale.receiptNo} />
            )}
            <ReceiptWindowButton saleId={sale.id} />
          </div>
        }
      />

      {/* 返品済み / 返品伝票の案内 */}
      {returnRecord && (
        <p className="mb-4 rounded-lg bg-rose-50 px-4 py-2.5 text-sm text-rose-800">
          この取引は {formatDateTime(returnRecord.soldAt)} に返品されました。
          <Link href={`/sales/${returnRecord.id}`} className="ml-1 font-medium underline">
            返品伝票 {returnRecord.receiptNo} を見る
          </Link>
        </p>
      )}
      {originalSaleId && (
        <p className="mb-4 rounded-lg bg-ink-50 px-4 py-2.5 text-sm text-ink-600">
          この伝票は返品伝票です。
          <Link href={`/sales/${originalSaleId}`} className="ml-1 font-medium underline">
            元の伝票を見る
          </Link>
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="明細" className="lg:col-span-2">
          <Table head={["商品", "SKU", "カラー / サイズ", "単価", "数量", "値引", "小計"]}>
            {sale.lines.map((line) => {
              const discountRate = markdownRate(line.listPriceAtSale, line.unitPrice);
              return (
                <tr key={line.id} className="border-b border-ink-100 last:border-0">
                  <td className="px-2 py-2.5">
                    {line.variant ? (
                      <>
                        <Link
                          href={`/products/${line.variant.productId}`}
                          className="font-medium text-ink-800 hover:text-accent"
                        >
                          {line.variant.product.name}
                        </Link>
                        <div className="text-xs text-ink-400">
                          {line.variant.product.styleCode} · {line.variant.product.season.code}
                          {discountRate > 0 && (
                            <span className="ml-1 text-accent">
                              値下げ販売 -{formatPercent(discountRate, 0)}
                            </span>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="font-medium text-ink-800">
                          {line.note ?? "手入力商品"}
                        </span>
                        <div className="text-xs text-ink-400">手入力 (未登録商品)</div>
                      </>
                    )}
                  </td>
                  <td className="tabular px-2 py-2.5 text-xs text-ink-400">
                    {line.variant?.sku ?? "—"}
                  </td>
                  <td className="px-2 py-2.5 whitespace-nowrap">
                    {line.variant ? (
                      <span className="flex items-center gap-1.5 text-sm text-ink-600">
                        <span
                          className="inline-block h-3 w-3 rounded-full border border-ink-200"
                          style={{ backgroundColor: line.variant.colorHex ?? "transparent" }}
                        />
                        {line.variant.colorName} / {line.variant.sizeName}
                      </span>
                    ) : (
                      <span className="text-sm text-ink-400">—</span>
                    )}
                  </td>
                  <td className="tabular px-2 py-2.5">{formatYen(line.unitPrice)}</td>
                  <td className="tabular px-2 py-2.5">{line.quantity}</td>
                  <td className="tabular px-2 py-2.5 text-ink-400">
                    {line.discount ? `-${formatYen(line.discount)}` : "—"}
                  </td>
                  <td className="tabular px-2 py-2.5 font-medium">{formatYen(line.lineTotal)}</td>
                </tr>
              );
            })}
          </Table>
        </Card>

        <div className="space-y-4">
          <Card title="お会計">
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-400">小計 (税抜)</dt>
                <dd className="tabular">{formatYen(sale.subtotal)}</dd>
              </div>
              {sale.discount > 0 && (
                <div className="flex justify-between">
                  <dt className="text-ink-400">伝票値引き</dt>
                  <dd className="tabular text-accent">-{formatYen(sale.discount)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-ink-400">消費税</dt>
                <dd className="tabular">{formatYen(sale.tax)}</dd>
              </div>
              <div className="flex justify-between border-t border-ink-200 pt-2.5 text-base font-semibold">
                <dt>合計 (税込)</dt>
                <dd className="tabular">{formatYen(sale.total)}</dd>
              </div>
              {/* 分割決済のときは内訳を1行ずつ出す */}
              {sale.payments.length > 1 ? (
                <div className="border-t border-ink-100 pt-2.5">
                  <dt className="mb-1.5 text-ink-400">支払方法 (分割)</dt>
                  {sale.payments.map((payment) => (
                    <div key={payment.id} className="flex justify-between py-0.5">
                      <dd className="text-ink-600">
                        {paymentLabels[payment.method] ??
                          PAYMENT_METHOD_LABEL[payment.method] ??
                          payment.method}
                        {payment.tendered != null && (
                          <span className="ml-1 text-xs text-ink-400">
                            (預り {formatYen(payment.tendered)} / 釣 {formatYen(payment.change ?? 0)})
                          </span>
                        )}
                      </dd>
                      <dd className="tabular">{formatYen(payment.amount)}</dd>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex justify-between pt-1">
                  <dt className="text-ink-400">支払方法</dt>
                  <dd>
                    {paymentLabels[sale.paymentMethod] ??
                      PAYMENT_METHOD_LABEL[sale.paymentMethod] ??
                      sale.paymentMethod}
                  </dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-ink-400">点数</dt>
                <dd className="tabular">{itemCount} 点</dd>
              </div>
            </dl>
          </Card>

          <Card title="顧客 / ポイント">
            {sale.customer ? (
              <div className="space-y-2.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/customers/${sale.customer.id}`}
                    className="font-medium text-ink-900 hover:text-accent"
                  >
                    {fullName(sale.customer)}
                  </Link>
                  <Badge tone={sale.customer.rank === "PLATINUM" ? "accent" : "neutral"}>
                    {rankLabel(sale.customer.rank)}
                  </Badge>
                </div>
                <div className="tabular text-xs text-ink-400">{sale.customer.memberCode}</div>
                <div className="flex justify-between border-t border-ink-100 pt-2.5">
                  <dt className="text-ink-400">ポイント利用</dt>
                  <dd className="tabular">{sale.pointsUsed} pt</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-400">獲得ポイント</dt>
                  <dd className="tabular text-emerald-700">+{sale.pointsEarned} pt</dd>
                </div>
                {sale.pointEvents.length > 0 && (
                  <div className="border-t border-ink-100 pt-2.5 text-xs text-ink-400">
                    取引後残高 {sale.pointEvents[sale.pointEvents.length - 1].balance} pt
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-ink-400">非会員のお取引です</p>
            )}
          </Card>

          <Card title="連携情報">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-400">連携元</dt>
                <dd>{sale.source}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-400">外部取引ID</dt>
                <dd className="tabular text-right text-xs break-all">{sale.externalId ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-400">取込日時</dt>
                <dd className="tabular text-xs">{formatDateTime(sale.createdAt)}</dd>
              </div>
            </dl>
            {sale.note && (
              <p className="mt-3 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">{sale.note}</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
