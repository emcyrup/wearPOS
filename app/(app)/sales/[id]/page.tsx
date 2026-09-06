import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge, Card, LinkButton, PageHeader, Table } from "@/components/ui";
import { ReceiptWindowButton } from "@/components/print-button";
import { markdownRate, PAYMENT_METHOD_LABEL, rankLabel } from "@/lib/apparel";
import { MULTI_STORE } from "@/lib/config";
import { prisma } from "@/lib/db";
import { formatDateTime, formatPercent, formatYen, fullName } from "@/lib/format";
import { paymentMethodLabels } from "@/lib/payment-methods";
import { summarizeReturns } from "@/lib/returns";

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

  // この伝票に対する返品状況 (明細ごとの残数と、これまでの返品累計)
  const returnState = sale.type === "SALE" ? await summarizeReturns(sale) : null;

  // 支払方法の表示名は設定のマスタから引く (追加された支払方法にも対応)
  const paymentLabels = await paymentMethodLabels();


  const itemCount = sale.lines.reduce((sum, line) => sum + line.quantity, 0);

  // 返品状態: この伝票に対する返品伝票 (複数回の一部返品がありうる)
  const returnRecords =
    sale.type === "SALE"
      ? await prisma.sale.findMany({
          where: { originalSaleId: sale.id, type: "RETURN" },
          select: { id: true, receiptNo: true, soldAt: true, total: true },
          orderBy: { soldAt: "asc" },
        })
      : [];
  const fullyReturned = Boolean(returnState) && !returnState!.hasReturnable;
  const partiallyReturned = returnRecords.length > 0 && !fullyReturned;

  // 返品伝票の場合は元伝票へのリンクを出す
  const originalSaleId =
    sale.type === "RETURN"
      ? (sale.originalSaleId ??
        (sale.externalId?.startsWith("RETURN-")
          ? sale.externalId.slice("RETURN-".length).split("-")[0]
          : null))
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
            {fullyReturned && <Badge tone="danger">返品済み</Badge>}
            {partiallyReturned && <Badge tone="danger">一部返品</Badge>}
            <Badge tone="neutral">{sale.source}</Badge>
            {sale.type === "SALE" && returnState?.hasReturnable && (
              <LinkButton href={`/sales/${sale.id}/return`}>返品する</LinkButton>
            )}
            <ReceiptWindowButton saleId={sale.id} />
          </div>
        }
      />

      {/* 返品済み / 返品伝票の案内 */}
      {returnRecords.length > 0 && (
        <div className="mb-4 rounded-lg bg-rose-50 px-4 py-2.5 text-sm text-rose-800">
          <p>
            {fullyReturned
              ? "この取引は返品されました。"
              : "この取引は一部の商品が返品されています。残りは引き続き返品できます。"}
          </p>
          <ul className="mt-1 space-y-0.5">
            {returnRecords.map((record) => (
              <li key={record.id}>
                {formatDateTime(record.soldAt)} · {formatYen(record.total)}
                <Link href={`/sales/${record.id}`} className="ml-1 font-medium underline">
                  返品伝票 {record.receiptNo} を見る
                </Link>
              </li>
            ))}
          </ul>
        </div>
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
              const returnedQuantity =
                returnState?.lines.find((row) => row.lineId === line.id)?.returnedQuantity ?? 0;
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
                  <td className="tabular px-2 py-2.5 whitespace-nowrap">
                    {line.quantity}
                    {returnedQuantity > 0 && (
                      <span className="ml-1 text-xs text-rose-700">
                        (返品 {returnedQuantity})
                      </span>
                    )}
                  </td>
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
                        {payment.note && (
                          <span className="ml-1 text-xs text-ink-400">No. {payment.note}</span>
                        )}
                      </dd>
                      <dd className="tabular">{formatYen(payment.amount)}</dd>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex justify-between pt-1">
                  <dt className="text-ink-400">支払方法</dt>
                  <dd className="text-right">
                    {paymentLabels[sale.paymentMethod] ??
                      PAYMENT_METHOD_LABEL[sale.paymentMethod] ??
                      sale.paymentMethod}
                    {sale.payments[0]?.note && (
                      <span className="block text-xs text-ink-400">
                        No. {sale.payments[0].note}
                      </span>
                    )}
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
