import Link from "next/link";

import { ColorMixChart, SalesTrendChart, SizeMixChart } from "@/components/charts";
import { Badge, Card, EmptyState, PageHeader, StatCard, StockCell, Table } from "@/components/ui";
import {
  customerInsights,
  dailySalesTrend,
  endOfDay,
  lastNDays,
  lowStockItems,
  previousRange,
  startOfDay,
  salesByColorAndSize,
  salesBySeason,
  salesByStaff,
  salesByStore,
  salesSummary,
  topSellingVariants,
} from "@/lib/analytics";
import { AiInsights } from "@/components/ai-insights";
import { DashboardCustomizer } from "@/components/dashboard-customizer";
import { DateRangePicker } from "@/components/date-range-picker";
import { rankLabel } from "@/lib/apparel";
import { getSessionUser } from "@/lib/auth";
import { type DashboardSectionKey } from "@/lib/dashboard";
import { prisma } from "@/lib/db";
import { formatNumber, formatPercent, formatYen, toDateInputValue } from "@/lib/format";

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

/** YYYY-MM-DD をローカル日付として安全に読む。不正なら null */
function parseDateParam(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;

  // カレンダー指定 (from/to) を優先し、無ければ従来のプリセット日数
  const fromParam = parseDateParam(params.from);
  const toParam = parseDateParam(params.to);
  const isCustom = Boolean(fromParam && toParam && fromParam <= toParam);

  const days = PERIODS.some((p) => String(p.days) === params.days) ? Number(params.days) : 30;
  const range = isCustom
    ? { from: startOfDay(fromParam as Date), to: endOfDay(toParam as Date) }
    : lastNDays(days);
  const prev = previousRange(range);

  const rangeDays = Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000);
  const rangeLabel = isCustom
    ? `${toDateInputValue(range.from).replaceAll("-", "/")} 〜 ${toDateInputValue(range.to).replaceAll("-", "/")}`
    : `直近${days}日間`;

  // ユーザーごとの表示カスタマイズ (非表示セクションは取得もスキップする)
  const sessionUser = await getSessionUser();
  const hidden = sessionUser?.uid
    ? ((
        await prisma.appUser.findUnique({
          where: { id: sessionUser.uid },
          select: { dashboardHidden: true },
        })
      )?.dashboardHidden ?? [])
    : [];
  const show = (key: DashboardSectionKey) => !hidden.includes(key);

  const empty = { colors: [], sizes: [] };
  const [summary, prevSummary, trend, stores, staff, topSkus, mix, seasons, customers, lowStock] =
    await Promise.all([
      salesSummary(range),
      show("kpi") ? salesSummary(prev) : null,
      show("trend") ? dailySalesTrend(range) : [],
      show("store") ? salesByStore(range) : [],
      show("staffPerf") ? salesByStaff(range) : [],
      show("topSku") ? topSellingVariants(range) : [],
      show("mix") ? salesByColorAndSize(range) : empty,
      show("season") ? salesBySeason(range) : [],
      show("customers") ? customerInsights(range) : null,
      show("lowStock") ? lowStockItems(8) : [],
    ]);

  const hasSales = summary.transactionCount > 0;

  return (
    <>
      <PageHeader
        title="売上ダッシュボード"
        description={`${rangeLabel}の実績 — 直前の同じ長さの期間 (${rangeDays}日間) との比較`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-lg border border-ink-200 bg-white p-0.5">
              {PERIODS.map((period) => (
                <Link
                  key={period.days}
                  href={`/?days=${period.days}`}
                  className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                    !isCustom && period.days === days
                      ? "bg-ink-900 text-white"
                      : "text-ink-600 hover:bg-ink-50"
                  }`}
                >
                  {period.label}
                </Link>
              ))}
            </div>
            <DateRangePicker
              from={toDateInputValue(range.from)}
              to={toDateInputValue(range.to)}
              active={isCustom}
            />
            {sessionUser?.uid && <DashboardCustomizer hidden={hidden} />}
          </div>
        }
      />

      {/*
        全セクションを1つのグリッドに載せ、CSS order でモバイルとデスクトップの
        並び順を切り替える。モバイル: KPI → 売上推移 → AI考察 → その他。
        デスクトップ: AI考察のみ order-last で従来どおり最下部に置く。
      */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {show("kpi") && (
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:col-span-3 xl:grid-cols-4">
        <StatCard
          label="純売上 (税込)"
          value={formatYen(summary.netSales)}
          trend={prevSummary ? growth(summary.netSales, prevSummary.netSales) : null}
          sub={summary.returns > 0 ? `返品 ${formatYen(summary.returns)}` : undefined}
        />
        <StatCard
          label="客数"
          value={formatNumber(summary.transactionCount)}
          trend={prevSummary ? growth(summary.transactionCount, prevSummary.transactionCount) : null}
          sub={`${formatNumber(summary.itemCount)} 点`}
        />
        <StatCard
          label="客単価"
          value={formatYen(summary.averageOrderValue)}
          trend={prevSummary ? growth(summary.averageOrderValue, prevSummary.averageOrderValue) : null}
          sub={`1会計 ${summary.unitsPerTransaction.toFixed(2)} 点`}
        />
        <StatCard
          label="プロパー消化率"
          value={formatPercent(summary.properSellThrough)}
          sub={`会員売上比 ${formatPercent(summary.memberSalesRatio, 0)}`}
        />
      </div>
      )}

      {show("trend") && (
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
      )}

      {/* モバイルではここ (売上推移の直下)、lg 以上では order-last で最下部 */}
      {show("ai") && (
      <div className="min-w-0 lg:order-last lg:col-span-3">
        <AiInsights from={toDateInputValue(range.from)} to={toDateInputValue(range.to)} />
      </div>
      )}

      {show("customers") && customers && (
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
      )}

      {show("mix") && (
      <div className="grid grid-cols-1 gap-4 lg:col-span-3 lg:grid-cols-2">
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
      )}

      {(show("topSku") || show("season") || show("store")) && (
      <div className="grid grid-cols-1 gap-4 lg:col-span-3 lg:grid-cols-2">
        {show("topSku") && (
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
        )}

        {(show("season") || show("store")) && (
        <div className="space-y-4">
          {show("season") && (
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
          )}

          {show("store") && (
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
          )}
        </div>
        )}
      </div>
      )}

      {(show("staffPerf") || show("lowStock")) && (
      <div className="grid grid-cols-1 gap-4 lg:col-span-3 lg:grid-cols-2">
        {show("staffPerf") && (
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
        )}

        {show("lowStock") && (
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
                  <td className="px-2 py-2 text-ink-600">{item.storeName}</td>
                  <td className="px-2 py-2">
                    <div className="font-medium text-ink-800">{item.productName}</div>
                    <div className="tabular text-xs text-ink-400">{item.sku}</div>
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
        )}
      </div>
      )}
      </div>
    </>
  );
}
