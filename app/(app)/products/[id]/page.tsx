import Link from "next/link";
import { notFound } from "next/navigation";

import { AssignBarcodesButton } from "@/components/assign-barcodes-button";
import { Barcode } from "@/components/barcode";
import { Badge, Card, EmptyState, LinkButton, PageHeader, StockCell, Table } from "@/components/ui";
import {
  markdownRate,
  properSellThroughRate,
  seasonPhase,
  sellThroughRate,
  SEASON_PHASE_LABEL,
} from "@/lib/apparel";
import { prisma } from "@/lib/db";
import { formatDate, formatNumber, formatPercent, formatYen } from "@/lib/format";
import { ensureProductFields } from "@/lib/product-fields";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      brand: true,
      category: true,
      season: true,
      fieldValues: { include: { field: true } },
      priceChanges: { orderBy: { changedAt: "desc" } },
      variants: {
        orderBy: [{ colorCode: "asc" }, { sizeOrder: "asc" }],
        include: {
          inventory: { include: { store: true } },
          saleLines: {
            where: { sale: { type: "SALE" } },
            select: { quantity: true, unitPrice: true, discount: true, listPriceAtSale: true, lineTotal: true },
          },
        },
      },
    },
  });

  if (!product) notFound();

  const stores = await prisma.store.findMany({ where: { isActive: true }, orderBy: { code: "asc" } });

  // 設定 (商品の基本情報 項目) の表示・並び順に従って商品情報の行を組み立てる
  const productFields = await ensureProductFields();
  const fieldRows: [string, string][] = productFields
    .filter((field) => field.isVisible)
    .map((field) => {
      switch (field.builtinKey) {
        case "brand":
          return [field.label, product.brand.name];
        case "category":
          return [field.label, product.category.name];
        case "season":
          return [field.label, `${product.season.code} (${product.season.name})`];
        case "material":
          return [field.label, product.material ?? "—"];
        case "originCountry":
          return [field.label, product.originCountry ?? "—"];
        case "careNote":
          return [field.label, product.careNote ?? "—"];
        default:
          return [
            field.label,
            product.fieldValues.find((entry) => entry.fieldId === field.id)?.value ?? "—",
          ];
      }
    });

  // カラー×サイズのマトリクスを組み立てる
  const colors = Array.from(
    new Map(
      product.variants.map((v) => [v.colorCode, { code: v.colorCode, name: v.colorName, hex: v.colorHex }]),
    ).values(),
  );
  const sizes = Array.from(
    new Map(
      product.variants.map((v) => [v.sizeCode, { code: v.sizeCode, name: v.sizeName, order: v.sizeOrder }]),
    ).values(),
  ).sort((a, b) => a.order - b.order);

  const cellByKey = new Map(
    product.variants.map((variant) => {
      const onHand = variant.inventory.reduce((sum, inv) => sum + inv.quantity, 0);
      const sold = variant.saleLines.reduce((sum, line) => sum + line.quantity, 0);
      return [`${variant.colorCode}:${variant.sizeCode}`, { variant, onHand, sold }];
    }),
  );

  const totalOnHand = product.variants.reduce(
    (sum, v) => sum + v.inventory.reduce((s, inv) => s + inv.quantity, 0),
    0,
  );
  const allLines = product.variants.flatMap((v) => v.saleLines);
  const totalSold = allLines.reduce((sum, line) => sum + line.quantity, 0);
  const totalSales = allLines.reduce((sum, line) => sum + line.lineTotal, 0);
  const discount = markdownRate(product.listPrice, product.currentPrice);
  const phase = seasonPhase(product.season);
  const missingBarcodes = product.variants.filter((v) => !v.barcode).length;

  // 店舗別の在庫合計
  const storeTotals = stores.map((store) => ({
    store,
    quantity: product.variants.reduce(
      (sum, v) => sum + (v.inventory.find((inv) => inv.storeId === store.id)?.quantity ?? 0),
      0,
    ),
  }));

  const grossMargin =
    product.currentPrice > 0 ? (product.currentPrice - product.costPrice) / product.currentPrice : 0;

  return (
    <>
      <div className="mb-2">
        <Link href="/products" className="text-sm text-ink-400 hover:text-ink-600">
          ← 商品一覧
        </Link>
      </div>

      <PageHeader
        title={product.name}
        description={`${product.styleCode} · ${product.brand.name} · ${product.category.name}`}
        action={
          <div className="flex items-center gap-2">
            <Badge tone={phase === "PROPER" ? "success" : phase === "SALE" ? "warning" : "neutral"}>
              {product.season.code} {SEASON_PHASE_LABEL[phase]}
            </Badge>
            <Badge tone={product.status === "ACTIVE" ? "info" : "neutral"}>
              {product.status === "ACTIVE" ? "販売中" : "販売終了"}
            </Badge>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-ink-200 bg-white px-5 py-4">
          <p className="text-xs font-medium text-ink-400">販売価格 (税抜)</p>
          <p className="tabular mt-1.5 text-2xl font-semibold tracking-tight">
            {formatYen(product.currentPrice)}
          </p>
          {discount > 0 ? (
            <p className="mt-1 text-xs text-accent">
              <span className="line-through text-ink-400">{formatYen(product.listPrice)}</span>
              <span className="ml-1">-{formatPercent(discount, 0)} 値下げ中</span>
            </p>
          ) : (
            <p className="mt-1 text-xs text-ink-400">プロパー価格</p>
          )}
        </div>
        <div className="rounded-xl border border-ink-200 bg-white px-5 py-4">
          <p className="text-xs font-medium text-ink-400">累計販売</p>
          <p className="tabular mt-1.5 text-2xl font-semibold tracking-tight">
            {formatNumber(totalSold)} <span className="text-base font-normal text-ink-400">点</span>
          </p>
          <p className="mt-1 text-xs text-ink-400">{formatYen(totalSales)}</p>
        </div>
        <div className="rounded-xl border border-ink-200 bg-white px-5 py-4">
          <p className="text-xs font-medium text-ink-400">消化率</p>
          <p className="tabular mt-1.5 text-2xl font-semibold tracking-tight">
            {formatPercent(sellThroughRate(totalSold, totalOnHand))}
          </p>
          <p className="mt-1 text-xs text-ink-400">
            プロパー消化 {formatPercent(properSellThroughRate(allLines), 0)}
          </p>
        </div>
        <div className="rounded-xl border border-ink-200 bg-white px-5 py-4">
          <p className="text-xs font-medium text-ink-400">在庫 (全店)</p>
          <p className="tabular mt-1.5 text-2xl font-semibold tracking-tight">
            {formatNumber(totalOnHand)} <span className="text-base font-normal text-ink-400">点</span>
          </p>
          <p className="mt-1 text-xs text-ink-400">粗利率 {formatPercent(grossMargin, 0)}</p>
        </div>
      </div>

      <Card
        title="カラー × サイズ 在庫マトリクス"
        className="mt-4"
        action={<span className="text-xs text-ink-400">上段: 在庫 / 下段: 累計販売</span>}
      >
        <div className="-mx-5 overflow-x-auto px-5">
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white px-3 py-2 text-left text-xs font-medium text-ink-400">
                  カラー
                </th>
                {sizes.map((size) => (
                  <th
                    key={size.code}
                    className="px-3 py-2 text-center text-xs font-medium text-ink-400"
                  >
                    {size.name}
                  </th>
                ))}
                <th className="px-3 py-2 text-center text-xs font-medium text-ink-400">計</th>
              </tr>
            </thead>
            <tbody>
              {colors.map((color) => {
                const rowTotal = sizes.reduce(
                  (sum, size) => sum + (cellByKey.get(`${color.code}:${size.code}`)?.onHand ?? 0),
                  0,
                );
                return (
                  <tr key={color.code} className="border-t border-ink-100">
                    <td className="sticky left-0 bg-white px-3 py-2 whitespace-nowrap">
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block h-3.5 w-3.5 rounded-full border border-ink-200"
                          style={{ backgroundColor: color.hex ?? "transparent" }}
                        />
                        <span className="font-medium text-ink-800">{color.name}</span>
                        <span className="tabular text-xs text-ink-400">{color.code}</span>
                      </span>
                    </td>
                    {sizes.map((size) => {
                      const cell = cellByKey.get(`${color.code}:${size.code}`);
                      if (!cell) {
                        return (
                          <td key={size.code} className="px-3 py-2 text-center text-ink-200">
                            —
                          </td>
                        );
                      }
                      return (
                        <td key={size.code} className="px-3 py-2 text-center">
                          <StockCell quantity={cell.onHand} />
                          <div className="tabular mt-0.5 text-xs text-ink-400">{cell.sold}</div>
                        </td>
                      );
                    })}
                    <td className="tabular px-3 py-2 text-center font-semibold">{rowTotal}</td>
                  </tr>
                );
              })}
              <tr className="border-t border-ink-200 bg-ink-50">
                <td className="sticky left-0 bg-ink-50 px-3 py-2 text-xs font-medium text-ink-400">計</td>
                {sizes.map((size) => {
                  const colTotal = colors.reduce(
                    (sum, color) => sum + (cellByKey.get(`${color.code}:${size.code}`)?.onHand ?? 0),
                    0,
                  );
                  return (
                    <td key={size.code} className="tabular px-3 py-2 text-center font-semibold">
                      {colTotal}
                    </td>
                  );
                })}
                <td className="tabular px-3 py-2 text-center font-semibold">{totalOnHand}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="店舗別在庫">
          <Table head={["店舗", "在庫"]}>
            {storeTotals.map((row) => (
              <tr key={row.store.id} className="border-b border-ink-100 last:border-0">
                <td className="px-2 py-2 font-medium text-ink-800">{row.store.name}</td>
                <td className="px-2 py-2">
                  <StockCell quantity={row.quantity} />
                </td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="価格改定履歴">
          {product.priceChanges.length ? (
            <Table head={["日付", "変更", "理由"]}>
              {product.priceChanges.map((change) => (
                <tr key={change.id} className="border-b border-ink-100 last:border-0">
                  <td className="tabular px-2 py-2 text-ink-600">{formatDate(change.changedAt)}</td>
                  <td className="tabular px-2 py-2">
                    <span className="text-ink-400 line-through">{formatYen(change.fromPrice)}</span>
                    <span className="mx-1 text-ink-400">→</span>
                    <span className="font-medium text-accent">{formatYen(change.toPrice)}</span>
                  </td>
                  <td className="px-2 py-2 text-xs text-ink-400">{change.note ?? change.reason}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState message="価格改定はまだありません" hint="プロパー価格のまま販売中です" />
          )}
        </Card>
      </div>

      <Card title="商品情報" className="mt-4">
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          {[
            ["品番", product.styleCode],
            ...fieldRows,
            ["原価", formatYen(product.costPrice)],
            ["消費税率", `${Math.round(product.taxRate * 100)}%`],
            ["登録日", formatDate(product.createdAt)],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 border-b border-ink-100 pb-2">
              <dt className="shrink-0 text-ink-400">{label}</dt>
              <dd className="text-right text-ink-800">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card
        title="SKU 一覧"
        className="mt-4"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {missingBarcodes > 0 && (
              <AssignBarcodesButton productId={product.id} missingCount={missingBarcodes} />
            )}
            <LinkButton href={`/products/${product.id}/labels`}>値札ラベルを印刷</LinkButton>
          </div>
        }
      >
        <Table head={["SKU", "カラー", "サイズ", "バーコード (JAN)", "在庫", "累計販売"]}>
          {product.variants.map((variant) => {
            const cell = cellByKey.get(`${variant.colorCode}:${variant.sizeCode}`);
            return (
              <tr key={variant.id} className="border-b border-ink-100 last:border-0">
                <td className="tabular px-2 py-2 text-xs text-ink-600">{variant.sku}</td>
                <td className="px-2 py-2">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-3 w-3 rounded-full border border-ink-200"
                      style={{ backgroundColor: variant.colorHex ?? "transparent" }}
                    />
                    {variant.colorName}
                  </span>
                </td>
                <td className="px-2 py-2">{variant.sizeName}</td>
                <td className="px-2 py-2">
                  {variant.barcode ? (
                    <Barcode code={variant.barcode} moduleWidth={1.2} height={28} />
                  ) : (
                    <span className="text-xs text-ink-400">—</span>
                  )}
                </td>
                <td className="px-2 py-2">
                  <StockCell quantity={cell?.onHand ?? 0} />
                </td>
                <td className="tabular px-2 py-2">{cell?.sold ?? 0}</td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
