import Link from "next/link";

import { ColorMixChart, SalesTrendChart, SizeMixChart } from "@/components/charts";
import { Badge, Card, EmptyState, PageHeader, StatCard, StockCell, Table } from "@/components/ui";
import {
  customerInsights,
  dailySalesTrend,
  lastNDays,
  previousRange,
  salesByColorAndSize,
  salesBySeason,
  salesByStaff,
  salesByStore,
  salesSummary,
  topSellingVariants,
} from "@/lib/analytics";
import { rankLabel } from "@/lib/apparel";
import { lowStockItems } from "@/lib/inventory";
import { formatNumber, formatPercent, formatYen } from "@/lib/format";

export const dynamic = "force-dynamic";

const PERIODS = [
  { days: 7, label: "7日間" },
  { days: 30, label: "30日間" },
  { days: 90, label: "90日間" },
];

function growth(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / previous;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const params = await searchParams;
  const days = PERIODS.some((p) => String(p.days) === params.days) ? Number(params.days) : 30;

  const range = lastNDays(days);
  const prev = previousRange(range);

  const [summary, prevSummary, trend, stores, staff, topSkus, mix, seasons, customers, lowStock] =
    await Promise.all([
      salesSummary({ range }),
      salesSummary({ range: prev }),
      dailySalesTrend({ range }),
      salesByStore(range),
      salesByStaff({ range }),
      topSellingVariants({ range }),
      salesByColorAndSize({ range }),
      salesBySeason({ range }),
      customerInsights(range),
      lowStockItems(8),
    ]);

  const hasSales = summary.transactionCount > 0;

  return (
    <>
      <PageHeader
        title="売上ダッシュボード"
        description={`直近${days}日間の実績 — 前${days}日間との比較`}
        action={
          <div className="flex gap-1 rounded-lg border border-ink-200 bg-white p-0.5">
            {PERIODS.map((period) => (
              <Link
                key={period.days}
                href={`/?days=${period.days}`}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                  period.days === days ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-50"
                }`}
              >
                {period.label}
              </Link>
            ))}
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="純売上 (税込)"
          value={formatYen(summary.netSales)}
          trend={growth(summary.netSales, prevSummary.netSales)}
          sub={summary.returns > 0 ? `返品 ${formatYen(summary.returns)}` : undefined}
        />
        <StatCard
          label="客数"
          value={formatNumber(summary.transactionCount)}
          trend={growth(summary.transactionCount, prevSummary.transactionCount)}
          sub={`${formatNumber(summary.itemCount)} 点`}
        />
        <StatCard
          label="客単価"
          value={formatYen(summary.averageOrderValue)}
          trend={growth(summary.averageOrderValue, prevSummary.averageOrderValue)}
          sub={`1会計 ${summary.unitsPerTransaction.toFixed(2)} 点`}
        />
        <StatCard
          label="プロパー消化率"
          value={formatPercent(summary.properSellThrough)}
          sub={`会員売上比 ${formatPercent(summary.memberSalesRatio, 0)}`}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="売上推移" className="lg:col-span-2">
          {hasSales ? (
            <SalesTrendChart data={trend} />
          ) : (
            <EmptyState
              message="この期間の取引がまだありません"
              hint="POS連携APIから取引を送信するとここに表示されます"
            />
          )}
        </Card>

        <Card title="顧客サマリ" action={<Link href="/customers" className="text-xs text-accent">一覧へ</Link>}>
          <dl className="space-y-3 text-sm">
            <div className="flex items-baseline justify-between">
              <dt className="text-ink-400">会員数</dt>
              <dd className="tabular font-semibold">{formatNumber(customers.totalCustomers)} 名</dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-ink-400">期間内の新規</dt>
              <dd className="tabular font-semibold">{formatNumber(customers.newCustomers)} 名</dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-ink-400">リピート率</dt>
              <dd className="tabular font-semibold">{formatPercent(customers.repeatRate)}</dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-ink-400">LINE連携率</dt>
              <dd className="tabular font-semibold">
                {formatPercent(customers.lineLinkRate)}
                <span className="ml-1 text-xs font-normal text-ink-400">
                  ({customers.lineLinkedCount}名)
                </span>
              </dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-ink-400">休眠 (90日以上)</dt>
              <dd className="tabular font-semibold text-amber-700">
                {formatNumber(customers.dormantCustomers)} 名
              </dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-wrap gap-1.5 border-t border-ink-100 pt-4">
            {customers.rankCounts.map((row) => (
              <Badge key={row.rank} tone={row.rank === "PLATINUM" ? "accent" : "neutral"}>
                {rankLabel(row.rank)} {row.count}
              </Badge>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="カラー別 販売構成">
          {mix.colors.length ? (
            <ColorMixChart data={mix.colors.slice(0, 8)} />
          ) : (
            <EmptyState message="販売実績がありません" />
          )}
        </Card>
        <Card title="サイズ別 販売構成">
          {mix.sizes.length ? (
            <SizeMixChart data={mix.sizes} />
          ) : (
            <EmptyState message="販売実績がありません" />
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="売れ筋 SKU TOP10">
          {topSkus.length ? (
            <Table head={["SKU", "商品", "点数", "売上"]}>
              {topSkus.map((sku) => (
                <tr key={sku.variantId} className="border-b border-ink-100 last:border-0">
                  <td className="px-2 py-2">
                    <span className="tabular text-xs text-ink-400">{sku.sku}</span>
                  </td>
                  <td className="px-2 py-2">
                    <div className="font-medium text-ink-800">{sku.productName}</div>
                    <div className="text-xs text-ink-400">
                      {sku.colorName} / {sku.sizeName} · {sku.seasonCode}
                    </div>
                  </td>
                  <td className="tabular px-2 py-2 font-medium">{sku.quantity}</td>
                  <td className="tabular px-2 py-2">{formatYen(sku.sales)}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState message="販売実績がありません" />
          )}
        </Card>

        <div className="space-y-4">
          <Card title="シーズン別 売上">
            {seasons.length ? (
              <Table head={["シーズン", "点数", "売上", "プロパー率"]}>
                {seasons.map((season) => (
                  <tr key={season.code} className="border-b border-ink-100 last:border-0">
                    <td className="px-2 py-2">
                      <span className="font-medium text-ink-800">{season.code}</span>
                      <span className="ml-2 text-xs text-ink-400">{season.name}</span>
                    </td>
                    <td className="tabular px-2 py-2">{season.quantity}</td>
                    <td className="tabular px-2 py-2">{formatYen(season.sales)}</td>
                    <td className="tabular px-2 py-2">{formatPercent(season.properRate, 0)}</td>
                  </tr>
                ))}
              </Table>
            ) : (
              <EmptyState message="販売実績がありません" />
            )}
          </Card>

          <Card title="店舗別 売上">
            {stores.length ? (
              <Table head={["店舗", "客数", "売上"]}>
                {stores.map((store) => (
                  <tr key={store.storeId} className="border-b border-ink-100 last:border-0">
                    <td className="px-2 py-2 font-medium text-ink-800">{store.storeName}</td>
                    <td className="tabular px-2 py-2">{store.orders}</td>
                    <td className="tabular px-2 py-2">{formatYen(store.sales)}</td>
                  </tr>
                ))}
              </Table>
            ) : (
              <EmptyState message="販売実績がありません" />
            )}
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="スタッフ別 実績">
          {staff.length ? (
            <Table head={["スタッフ", "客数", "客単価", "売上"]}>
              {staff.map((row) => (
                <tr key={row.staffId} className="border-b border-ink-100 last:border-0">
                  <td className="px-2 py-2 font-medium text-ink-800">{row.staffName}</td>
                  <td className="tabular px-2 py-2">{row.orders}</td>
                  <td className="tabular px-2 py-2">{formatYen(row.averageOrderValue)}</td>
                  <td className="tabular px-2 py-2">{formatYen(row.sales)}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState message="販売実績がありません" />
          )}
        </Card>

        <Card
          title="在庫アラート (安全在庫割れ)"
          action={
            <Link href="/inventory" className="text-xs text-accent">
              在庫へ
            </Link>
          }
        >
          {lowStock.length ? (
            <Table head={["店舗", "SKU", "在庫", "発注点"]}>
              {lowStock.map((item) => (
                <tr key={item.id} className="border-b border-ink-100 last:border-0">
                  <td className="px-2 py-2 text-ink-600">{item.store.name}</td>
                  <td className="px-2 py-2">
                    <div className="font-medium text-ink-800">{item.variant.product.name}</div>
                    <div className="tabular text-xs text-ink-400">{item.variant.sku}</div>
                  </td>
                  <td className="px-2 py-2">
                    <StockCell quantity={item.quantity} safetyStock={item.safetyStock} />
                  </td>
                  <td className="tabular px-2 py-2 text-ink-400">{item.safetyStock}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState message="安全在庫を下回っている SKU はありません" />
          )}
        </Card>
      </div>
    </>
  );
}
