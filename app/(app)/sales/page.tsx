import Link from "next/link";

import { Badge, Card, EmptyState, PAGE_SIZE, PageHeader, Pagination, Table } from "@/components/ui";
import { PAYMENT_METHOD_LABEL } from "@/lib/apparel";
import { MULTI_STORE } from "@/lib/config";
import { prisma } from "@/lib/db";
import { formatDateTime, formatNumber, formatYen, fullName } from "@/lib/format";

export const dynamic = "force-dynamic";

type Search = { store?: string; q?: string; type?: string; from?: string; to?: string; page?: string };

/** 支払方法の表示順と、内訳グラフの色 */
const PAYMENT_METHOD_ORDER = ["CASH", "CREDIT", "E_MONEY", "QR", "OTHER"] as const;
const PAYMENT_COLORS: Record<string, string> = {
  CASH: "#059669",
  CREDIT: "#0284c7",
  E_MONEY: "#7c3aed",
  QR: "#d97706",
  OTHER: "#64748b",
};

export default async function SalesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";

  const stores = await prisma.store.findMany({ orderBy: { code: "asc" } });
  const storeId = stores.some((s) => s.id === params.store) ? params.store : undefined;

  const from = params.from ? new Date(`${params.from}T00:00:00`) : undefined;
  const to = params.to ? new Date(`${params.to}T23:59:59`) : undefined;

  const where = {
    ...(storeId ? { storeId } : {}),
    ...(params.type === "SALE" || params.type === "RETURN" ? { type: params.type } : {}),
    ...(from || to ? { soldAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(q
      ? {
          OR: [
            { receiptNo: { contains: q } },
            { externalId: { contains: q } },
            { customer: { memberCode: { contains: q } } },
            { customer: { lastName: { contains: q } } },
          ],
        }
      : {}),
  };

  const page = Math.max(1, Number(params.page) || 1);

  const [sales, aggregate, byPayment] = await Promise.all([
    prisma.sale.findMany({
      where,
      include: {
        store: true,
        staff: true,
        customer: true,
        lines: {
          select: {
            quantity: true,
            lineTotal: true,
            note: true,
            variant: { select: { product: { select: { name: true } } } },
          },
        },
      },
      orderBy: { soldAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.sale.aggregate({ where, _sum: { total: true }, _count: { _all: true } }),
    prisma.sale.groupBy({
      by: ["paymentMethod", "type"],
      where,
      _sum: { total: true },
      _count: { _all: true },
    }),
  ]);

  // 支払方法別の集計。返品は売上から差し引いた正味額で見せる
  const paymentStats = PAYMENT_METHOD_ORDER.map((method) => {
    const rows = byPayment.filter((row) => row.paymentMethod === method);
    const saleTotal = rows
      .filter((row) => row.type !== "RETURN")
      .reduce((sum, row) => sum + (row._sum.total ?? 0), 0);
    const returnTotal = rows
      .filter((row) => row.type === "RETURN")
      .reduce((sum, row) => sum + (row._sum.total ?? 0), 0);
    return {
      method,
      label: PAYMENT_METHOD_LABEL[method] ?? method,
      color: PAYMENT_COLORS[method] ?? "#64748b",
      net: saleTotal - returnTotal,
      count: rows.reduce((sum, row) => sum + row._count._all, 0),
      returnCount: rows
        .filter((row) => row.type === "RETURN")
        .reduce((sum, row) => sum + row._count._all, 0),
    };
  }).filter((stat) => stat.count > 0);

  const netTotal = paymentStats.reduce((sum, stat) => sum + stat.net, 0);
  const shareBase = paymentStats.reduce((sum, stat) => sum + Math.max(0, stat.net), 0);
  const saleCount = byPayment
    .filter((row) => row.type !== "RETURN")
    .reduce((sum, row) => sum + row._count._all, 0);
  const returnCount = aggregate._count._all - saleCount;
  const averageOrder = saleCount > 0 ? Math.round(netTotal / saleCount) : 0;

  return (
    <>
      <PageHeader
        title="取引履歴"
        description="店頭レジと POS 連携 API の取引を、支払方法別の内訳と一覧で確認できます"
        action={
          <div className="flex gap-2">
            <Badge tone="neutral">{formatNumber(aggregate._count._all)} 件</Badge>
            <Badge tone="accent">{formatYen(aggregate._sum.total ?? 0)}</Badge>
          </div>
        }
      />

      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-400">伝票番号・会員</span>
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="SHIBUYA-000123 / M10001"
              className="w-52 rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-ink-400"
            />
          </label>

          {MULTI_STORE && (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-400">店舗</span>
              <select
                name="store"
                defaultValue={storeId ?? ""}
                className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-ink-400"
              >
                <option value="">全店舗</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-400">区分</span>
            <select
              name="type"
              defaultValue={params.type ?? ""}
              className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-ink-400"
            >
              <option value="">すべて</option>
              <option value="SALE">販売</option>
              <option value="RETURN">返品</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-400">開始日</span>
            <input
              type="date"
              name="from"
              defaultValue={params.from ?? ""}
              className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-ink-400"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-400">終了日</span>
            <input
              type="date"
              name="to"
              defaultValue={params.to ?? ""}
              className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-ink-400"
            />
          </label>

          <button
            type="submit"
            className="rounded-lg bg-ink-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-ink-800"
          >
            絞り込む
          </button>
          <Link href="/sales" className="px-2 py-1.5 text-sm text-ink-400 hover:text-ink-600">
            クリア
          </Link>
        </form>
      </Card>

      {/* 絞り込み条件に連動する売上サマリー (支払方法別の内訳) */}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-ink-200 bg-white px-5 py-4">
          <p className="text-xs font-medium text-ink-400">売上合計 (返品差引・税込)</p>
          <p className="tabular mt-1.5 text-2xl font-semibold tracking-tight">
            {formatYen(netTotal)}
          </p>
        </div>
        <div className="rounded-xl border border-ink-200 bg-white px-5 py-4">
          <p className="text-xs font-medium text-ink-400">取引件数</p>
          <p className="tabular mt-1.5 text-2xl font-semibold tracking-tight">
            {formatNumber(saleCount)} 件
          </p>
          {returnCount > 0 && (
            <p className="mt-1 text-xs text-ink-400">ほか返品 {formatNumber(returnCount)} 件</p>
          )}
        </div>
        <div className="rounded-xl border border-ink-200 bg-white px-5 py-4">
          <p className="text-xs font-medium text-ink-400">平均客単価</p>
          <p className="tabular mt-1.5 text-2xl font-semibold tracking-tight">
            {formatYen(averageOrder)}
          </p>
        </div>
      </div>

      <Card title="支払方法別の内訳" className="mb-4">
        {paymentStats.length ? (
          <>
            {/* 構成比バー */}
            {shareBase > 0 && (
              <div className="flex h-3 overflow-hidden rounded-full bg-ink-100">
                {paymentStats
                  .filter((stat) => stat.net > 0)
                  .map((stat) => (
                    <div
                      key={stat.method}
                      title={`${stat.label} ${formatYen(stat.net)}`}
                      style={{
                        width: `${(stat.net / shareBase) * 100}%`,
                        backgroundColor: stat.color,
                      }}
                    />
                  ))}
              </div>
            )}
            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5 sm:grid-cols-3">
              {paymentStats.map((stat) => (
                <div key={stat.method} className="rounded-lg border border-ink-100 px-3 py-2.5">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-ink-500">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: stat.color }}
                    />
                    {stat.label}
                  </p>
                  <p className="tabular mt-1 text-lg font-semibold tracking-tight">
                    {formatYen(stat.net)}
                  </p>
                  <p className="tabular mt-0.5 text-[11px] text-ink-400">
                    {formatNumber(stat.count)} 件
                    {shareBase > 0 && stat.net > 0 && (
                      <> · {Math.round((stat.net / shareBase) * 100)}%</>
                    )}
                    {stat.returnCount > 0 && <> · 返品 {stat.returnCount}</>}
                  </p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="py-4 text-center text-sm text-ink-400">
            条件に一致する取引がないため内訳を表示できません
          </p>
        )}
      </Card>

      <Card>
        {sales.length ? (
          <Table
            minWidth={960}
            head={[
              "伝票番号",
              "日時",
              ...(MULTI_STORE ? ["店舗"] : []),
              "商品",
              "顧客",
              { label: "点数", align: "right" } as const,
              "支払",
              { label: "金額", align: "right" } as const,
              "担当",
            ]}
          >
            {sales.map((sale) => (
              <tr key={sale.id}>
                <td className="px-2 py-2.5">
                  <Link
                    href={`/sales/${sale.id}`}
                    className="tabular text-sm font-medium text-ink-900 hover:text-accent"
                  >
                    {sale.receiptNo}
                  </Link>
                  {sale.type === "RETURN" && (
                    <span className="ml-1">
                      <Badge tone="danger">返品</Badge>
                    </span>
                  )}
                </td>
                <td className="tabular px-2 py-2.5 text-xs whitespace-nowrap text-ink-400">
                  {formatDateTime(sale.soldAt)}
                </td>
                {MULTI_STORE && (
                  <td className="px-2 py-2.5 whitespace-nowrap text-ink-600">{sale.store.name}</td>
                )}
                {/* 購入商品: 全件表示し、商品ごとの点数と金額 (税抜) を添える */}
                <td className="min-w-52 px-2 py-2.5">
                  {sale.lines.length ? (
                    (() => {
                      const grouped = new Map<string, { quantity: number; amount: number }>();
                      for (const line of sale.lines) {
                        const label = line.variant?.product.name ?? line.note ?? "手入力商品";
                        const entry = grouped.get(label) ?? { quantity: 0, amount: 0 };
                        entry.quantity += line.quantity;
                        entry.amount += line.lineTotal;
                        grouped.set(label, entry);
                      }
                      return [...grouped.entries()].map(([label, entry]) => (
                        <span
                          key={label}
                          className="flex items-baseline justify-between gap-3 text-sm text-ink-800"
                        >
                          <span className="truncate">{label}</span>
                          <span className="tabular shrink-0 text-xs text-ink-400">
                            {entry.quantity}点 · {formatYen(entry.amount)}
                          </span>
                        </span>
                      ));
                    })()
                  ) : (
                    <span className="text-xs text-ink-400">—</span>
                  )}
                </td>
                <td className="px-2 py-2.5">
                  {sale.customer ? (
                    <Link
                      href={`/customers/${sale.customer.id}`}
                      className="text-ink-800 hover:text-accent"
                    >
                      {fullName(sale.customer)}
                    </Link>
                  ) : (
                    <span className="text-xs text-ink-400">非会員</span>
                  )}
                </td>
                <td className="tabular px-2 py-2.5 text-right text-ink-600">
                  {sale.lines.reduce((sum, line) => sum + line.quantity, 0)}
                </td>
                <td className="px-2 py-2.5 text-xs whitespace-nowrap text-ink-400">
                  {PAYMENT_METHOD_LABEL[sale.paymentMethod] ?? sale.paymentMethod}
                </td>
                <td className="tabular px-2 py-2.5 text-right font-medium">{formatYen(sale.total)}</td>
                <td className="px-2 py-2.5 text-xs whitespace-nowrap text-ink-400">
                  {sale.staff?.name ?? "—"}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState
            message="該当する取引がありません"
            hint="POS連携APIから取引を送信するとここに表示されます"
          />
        )}
        <Pagination
          page={page}
          total={aggregate._count._all}
          basePath="/sales"
          params={{
            store: params.store,
            q: params.q,
            type: params.type,
            from: params.from,
            to: params.to,
          }}
        />
      </Card>
    </>
  );
}
