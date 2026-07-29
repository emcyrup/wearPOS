import Link from "next/link";

import { StockAdjustForm } from "@/components/stock-adjust-form";
import { Badge, Card, EmptyState, PageHeader, StockCell, Table } from "@/components/ui";
import { MOVEMENT_TYPE_LABEL } from "@/lib/apparel";
import { prisma } from "@/lib/db";
import { inventoryList, recentMovements } from "@/lib/inventory";
import { formatDateTime, formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

type Search = { store?: string; q?: string; low?: string };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";

  const [stores, staff] = await Promise.all([
    prisma.store.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
    prisma.staff.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
  ]);

  const storeId = stores.some((s) => s.id === params.store) ? params.store : undefined;

  const [rows, movements] = await Promise.all([
    inventoryList({ storeId, keyword: q, lowOnly: params.low === "1" }),
    recentMovements(storeId),
  ]);

  const totalUnits = rows.reduce((sum, item) => sum + item.quantity, 0);
  const lowCount = rows.filter((i) => i.safetyStock > 0 && i.quantity <= i.safetyStock).length;

  return (
    <>
      <PageHeader
        title="在庫"
        description="店舗 × SKU 単位で在庫を管理します。すべての増減は履歴に残ります"
        action={
          <div className="flex gap-2">
            <Badge tone="neutral">{formatNumber(totalUnits)} 点</Badge>
            {lowCount > 0 && <Badge tone="warning">安全在庫割れ {lowCount}</Badge>}
          </div>
        }
      />

      <Card title="入荷 / 在庫調整 / 棚卸" className="mb-4">
        <StockAdjustForm
          stores={stores.map((s) => ({ id: s.id, name: s.name }))}
          staff={staff.map((s) => ({ id: s.id, name: s.name, storeId: s.storeId }))}
        />
      </Card>

      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3" method="get">
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

      <Card title={`在庫一覧 (${rows.length} 件)`}>
        {rows.length ? (
          <Table head={["店舗", "SKU", "商品", "カラー / サイズ", "シーズン", "在庫", "発注点"]}>
            {rows.map((item) => (
              <tr key={item.id} className="border-b border-ink-100 last:border-0 hover:bg-ink-50">
                <td className="px-2 py-2 whitespace-nowrap text-ink-600">{item.storeName}</td>
                <td className="tabular px-2 py-2 text-xs text-ink-400">{item.sku}</td>
                <td className="px-2 py-2">
                  <Link
                    href={`/products/${item.productId}`}
                    className="font-medium text-ink-800 hover:text-accent"
                  >
                    {item.productName}
                  </Link>
                </td>
                <td className="px-2 py-2 whitespace-nowrap">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-3 w-3 rounded-full border border-ink-200"
                      style={{ backgroundColor: item.colorHex ?? "transparent" }}
                    />
                    <span className="text-ink-600">
                      {item.colorName} / {item.sizeName}
                    </span>
                  </span>
                </td>
                <td className="tabular px-2 py-2 text-xs text-ink-400">{item.seasonCode}</td>
                <td className="px-2 py-2">
                  <StockCell quantity={item.quantity} safetyStock={item.safetyStock} />
                </td>
                <td className="tabular px-2 py-2 text-xs text-ink-400">{item.safetyStock}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState message="該当する在庫がありません" />
        )}
      </Card>

      <Card title="直近の在庫変動" className="mt-4">
        {movements.length ? (
          <Table head={["日時", "店舗", "区分", "SKU", "増減", "変動後", "担当"]}>
            {movements.map((movement) => (
              <tr key={movement.id} className="border-b border-ink-100 last:border-0">
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
                  className={`tabular px-2 py-2 font-medium ${
                    movement.quantity < 0 ? "text-rose-700" : "text-emerald-700"
                  }`}
                >
                  {movement.quantity > 0 ? `+${movement.quantity}` : movement.quantity}
                </td>
                <td className="tabular px-2 py-2">{movement.balance}</td>
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
