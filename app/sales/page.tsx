import Link from "next/link";

import { Badge, Card, EmptyState, PageHeader, Table } from "@/components/ui";
import { PAYMENT_METHOD_LABEL } from "@/lib/apparel";
import { prisma } from "@/lib/db";
import { formatDateTime, formatNumber, formatYen, fullName } from "@/lib/format";

export const dynamic = "force-dynamic";

type Search = { store?: string; q?: string; type?: string; from?: string; to?: string };

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

  const [sales, aggregate] = await Promise.all([
    prisma.sale.findMany({
      where,
      include: {
        store: true,
        staff: true,
        customer: true,
        lines: { select: { quantity: true } },
      },
      orderBy: { soldAt: "desc" },
      take: 100,
    }),
    prisma.sale.aggregate({ where, _sum: { total: true }, _count: { _all: true } }),
  ]);

  return (
    <>
      <PageHeader
        title="取引履歴"
        description="POSレジ連携APIで取り込まれた取引の一覧です"
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

      <Card>
        {sales.length ? (
          <Table head={["伝票番号", "日時", "店舗", "顧客", "点数", "支払", "金額", "担当"]}>
            {sales.map((sale) => (
              <tr key={sale.id} className="border-b border-ink-100 last:border-0 hover:bg-ink-50">
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
                <td className="px-2 py-2.5 whitespace-nowrap text-ink-600">{sale.store.name}</td>
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
                <td className="tabular px-2 py-2.5 text-ink-600">
                  {sale.lines.reduce((sum, line) => sum + line.quantity, 0)}
                </td>
                <td className="px-2 py-2.5 text-xs whitespace-nowrap text-ink-400">
                  {PAYMENT_METHOD_LABEL[sale.paymentMethod] ?? sale.paymentMethod}
                </td>
                <td className="tabular px-2 py-2.5 font-medium">{formatYen(sale.total)}</td>
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
        {aggregate._count._all > sales.length && (
          <p className="mt-3 text-center text-xs text-ink-400">
            直近 {sales.length} 件を表示しています（全 {formatNumber(aggregate._count._all)} 件）
          </p>
        )}
      </Card>
    </>
  );
}
