import Link from "next/link";

import { InventoryManager } from "@/components/inventory-manager";
import { Badge, Card, EmptyState, PAGE_SIZE, PageHeader, Pagination, Table } from "@/components/ui";
import { MOVEMENT_TYPE_LABEL } from "@/lib/apparel";
import { MULTI_STORE } from "@/lib/config";
import { prisma } from "@/lib/db";
import { inventoryList, recentMovements } from "@/lib/inventory";
import { formatDateTime, formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

type Search = { store?: string; q?: string; low?: string; page?: string };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";

  const [stores, staff] = await Promise.all([
    prisma.store.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
    prisma.staff.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
  ]);

  // 単店舗運用では常に先頭の店舗に絞る (店舗ごとの重複行を出さない)
  const storeId = MULTI_STORE
    ? stores.some((s) => s.id === params.store)
      ? params.store
      : undefined
    : stores[0]?.id;

  const page = Math.max(1, Number(params.page) || 1);

  const [inventory, movements] = await Promise.all([
    inventoryList({
      storeId,
      keyword: q,
      lowOnly: params.low === "1",
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    recentMovements(storeId),
  ]);

  const { rows, total, totalUnits, lowCount } = inventory;

  return (
    <>
      <PageHeader
        title="在庫"
        description={MULTI_STORE ? "店舗 × SKU 単位で在庫を管理します。すべての増減は履歴に残ります" : "SKU 単位で在庫を管理します。すべての増減は履歴に残ります"}
        action={
          <div className="flex gap-2">
            <Badge tone="neutral">{formatNumber(totalUnits)} 点</Badge>
            {lowCount > 0 && <Badge tone="warning">安全在庫割れ {lowCount}</Badge>}
          </div>
        }
      />

      <InventoryManager
        stores={stores.map((s) => ({ id: s.id, name: s.name }))}
        staff={staff.map((s) => ({ id: s.id, name: s.name, storeId: s.storeId }))}
        rows={rows.map((item) => ({
          id: item.id,
          sku: item.sku,
          productId: item.productId,
          productName: item.productName,
          colorName: item.colorName,
          colorHex: item.colorHex,
          sizeName: item.sizeName,
          seasonCode: item.seasonCode,
          quantity: item.quantity,
          safetyStock: item.safetyStock,
        }))}
        total={total}
      >
      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3" method="get">
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
            <span className="text-xs text-ink-400">SKU / 商品名</span>
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="26SS-SH-001 / シャツ"
              className="w-56 rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-ink-400"
            />
          </label>

          <label className="flex items-center gap-2 pb-2 text-sm text-ink-600">
            <input
              type="checkbox"
              name="low"
              value="1"
              defaultChecked={params.low === "1"}
              className="h-4 w-4 rounded border-ink-200"
            />
            安全在庫割れのみ
          </label>

          <button
            type="submit"
            className="rounded-lg bg-ink-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-ink-800"
          >
            絞り込む
          </button>
          <Link href="/inventory" className="px-2 py-1.5 text-sm text-ink-400 hover:text-ink-600">
            クリア
          </Link>
        </form>
      </Card>

      </InventoryManager>

      <Pagination
        page={page}
        total={total}
        basePath="/inventory"
        params={{ store: params.store, q: params.q, low: params.low }}
      />

      <Card title="直近の在庫変動" className="mt-4">
        {movements.length ? (
          <Table
            minWidth={760}
            head={[
              "日時",
              "店舗",
              "区分",
              "SKU",
              { label: "増減", align: "right" },
              { label: "変動後", align: "right" },
              "担当",
            ]}
          >
            {movements.map((movement) => (
              <tr key={movement.id}>
                <td className="tabular px-2 py-2 whitespace-nowrap text-xs text-ink-400">
                  {formatDateTime(movement.createdAt)}
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-ink-600">{movement.storeName}</td>
                <td className="px-2 py-2">
                  <Badge
                    tone={
                      movement.type === "SALE"
                        ? "info"
                        : movement.type === "INBOUND"
                          ? "success"
                          : "neutral"
                    }
                  >
                    {MOVEMENT_TYPE_LABEL[movement.type] ?? movement.type}
                  </Badge>
                </td>
                <td className="px-2 py-2">
                  <div className="text-ink-800">{movement.productName}</div>
                  <div className="tabular text-xs text-ink-400">{movement.sku}</div>
                </td>
                <td
                  className={`tabular px-2 py-2 text-right font-medium ${
                    movement.quantity < 0 ? "text-rose-700" : "text-emerald-700"
                  }`}
                >
                  {movement.quantity > 0 ? `+${movement.quantity}` : movement.quantity}
                </td>
                <td className="tabular px-2 py-2 text-right">{movement.balance}</td>
                <td className="px-2 py-2 text-xs text-ink-400">{movement.staffName ?? "—"}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState message="在庫変動の履歴がありません" />
        )}
      </Card>
    </>
  );
}
