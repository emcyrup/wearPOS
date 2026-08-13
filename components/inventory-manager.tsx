"use client";

import { useRef, useState } from "react";

import { LinkRow } from "@/components/link-row";
import { StockAdjustForm } from "@/components/stock-adjust-form";
import { Card, EmptyState, StockCell, Table } from "@/components/ui";

export type InventoryRow = {
  id: string;
  sku: string;
  productId: string;
  productName: string;
  colorName: string;
  colorHex: string | null;
  sizeName: string;
  seasonCode: string;
  quantity: number;
  safetyStock: number;
};

/**
 * 在庫の修正フォームと在庫一覧。
 * 一覧のラジオボタンで商品を選ぶと、その SKU が修正フォームに入る。
 * 行のクリック (ラジオ以外) は商品詳細への遷移。
 */
export function InventoryManager({
  stores,
  staff,
  rows,
  total,
  children,
}: {
  stores: { id: string; name: string }[];
  staff: { id: string; name: string; storeId: string | null }[];
  rows: InventoryRow[];
  total: number;
  /** フォームと一覧の間に挟む要素 (絞り込みフォームなど) */
  children?: React.ReactNode;
}) {
  const [sku, setSku] = useState("");
  const formRef = useRef<HTMLDivElement | null>(null);

  const select = (row: InventoryRow) => {
    setSku(row.sku);
    // 選択した SKU が修正フォームに入ったことが分かるようにスクロールする
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <>
      <div ref={formRef}>
        <Card title="在庫の修正 (入荷 / 在庫調整 / 棚卸)" className="mb-4">
          <p className="mb-3 text-xs text-ink-400">
            下の在庫一覧でラジオボタンを選ぶと、その商品の SKU がここに入ります。
            バーコードのスキャン・手入力でも指定できます。
          </p>
          <StockAdjustForm stores={stores} staff={staff} sku={sku} onSkuChange={setSku} />
        </Card>
      </div>

      {children}

      <Card title={`在庫一覧 (${total.toLocaleString("ja-JP")} 件)`}>
        {rows.length ? (
          <Table
            minWidth={880}
            head={[
              { label: "選択", align: "center" },
              "SKU",
              "商品",
              "カラー / サイズ",
              "シーズン",
              { label: "在庫", align: "right" },
              { label: "発注点", align: "right" },
            ]}
          >
            {rows.map((item) => (
              <LinkRow
                key={item.id}
                href={`/products/${item.productId}`}
                className={sku === item.sku ? "bg-accent-soft/40" : ""}
              >
                <td className="px-2 py-2 text-center">
                  <input
                    type="radio"
                    name="inventory-select"
                    checked={sku === item.sku}
                    onChange={() => select(item)}
                    aria-label={`${item.productName} (${item.sku}) を修正対象に選択`}
                    className="h-4 w-4 accent-ink-900"
                  />
                </td>
                <td className="tabular px-2 py-2 text-xs text-ink-400">{item.sku}</td>
                <td className="px-2 py-2 font-medium text-ink-800">{item.productName}</td>
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
                <td className="px-2 py-2 text-right">
                  <StockCell quantity={item.quantity} safetyStock={item.safetyStock} />
                </td>
                <td className="tabular px-2 py-2 text-right text-xs text-ink-400">
                  {item.safetyStock}
                </td>
              </LinkRow>
            ))}
          </Table>
        ) : (
          <EmptyState message="該当する在庫がありません" />
        )}
      </Card>
    </>
  );
}
