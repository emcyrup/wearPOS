import Link from "next/link";

import { MasterChipManager } from "@/components/master-managers";
import { ScanLookup } from "@/components/scan-lookup";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Table } from "@/components/ui";
import { markdownRate, seasonPhase, SEASON_PHASE_LABEL } from "@/lib/apparel";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatPercent, formatYen } from "@/lib/format";

export const dynamic = "force-dynamic";

type Search = { q?: string; season?: string; category?: string; status?: string };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const isAdmin = (await getSessionUser())?.role === "ADMIN";
  const q = params.q?.trim() ?? "";

  const [seasons, categories, brands] = await Promise.all([
    prisma.season.findMany({ orderBy: [{ year: "desc" }, { term: "asc" }] }),
    prisma.category.findMany({
      orderBy: { code: "asc" },
      include: { _count: { select: { products: true } } },
    }),
    prisma.brand.findMany({
      orderBy: { code: "asc" },
      include: { _count: { select: { products: true } } },
    }),
  ]);

  const products = await prisma.product.findMany({
    where: {
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { styleCode: { contains: q } },
              { variants: { some: { sku: { contains: q } } } },
            ],
          }
        : {}),
      ...(params.season ? { season: { code: params.season } } : {}),
      ...(params.category ? { category: { code: params.category } } : {}),
      ...(params.status ? { status: params.status } : {}),
    },
    include: {
      brand: true,
      category: true,
      season: true,
      variants: {
        include: { inventory: { select: { quantity: true } } },
      },
    },
    orderBy: { styleCode: "asc" },
  });

  const rows = products.map((product) => {
    const onHand = product.variants.reduce(
      (sum, variant) => sum + variant.inventory.reduce((s, inv) => s + inv.quantity, 0),
      0,
    );
    const colors = new Set(product.variants.map((v) => v.colorCode)).size;
    const sizes = new Set(product.variants.map((v) => v.sizeCode)).size;
    return { product, onHand, colors, sizes };
  });

  return (
    <>
      <PageHeader
        title="商品 / SKU"
        description="品番ごとにカラー×サイズの SKU を管理します"
        action={
          <div className="flex items-center gap-2">
            <Badge tone="neutral">
              {products.length} 品番 / {products.reduce((s, p) => s + p.variants.length, 0)} SKU
            </Badge>
            {isAdmin && (
              <LinkButton href="/products/new" variant="primary">
                商品を登録
              </LinkButton>
            )}
          </div>
        }
      />

      {/* バーコードスキャン照会 (商品画面に埋め込み。開くとカメラ / リーダーで照会できる) */}
      <details className="mb-4 rounded-xl border border-ink-200 bg-white">
        <summary className="cursor-pointer px-5 py-3.5 text-sm font-semibold text-ink-800 select-none hover:bg-ink-50">
          📷 バーコードスキャン照会
          <span className="ml-2 text-xs font-normal text-ink-400">
            値札の JAN / SKU を読み取って商品情報と店舗別在庫を確認
          </span>
        </summary>
        <div className="border-t border-ink-100 px-5 py-4">
          <ScanLookup />
        </div>
      </details>

      {/* 基本情報マスタ (ブランド / カテゴリ) の管理。ユーザーが任意に項目を作成できる */}
      {isAdmin && (
        <details className="mb-4 rounded-xl border border-ink-200 bg-white">
          <summary className="cursor-pointer px-5 py-3.5 text-sm font-semibold text-ink-800 select-none hover:bg-ink-50">
            🏷 ブランド / カテゴリの管理
            <span className="ml-2 text-xs font-normal text-ink-400">
              商品登録で選べる項目を追加・削除 (数字は使用商品数)
            </span>
          </summary>
          <div className="grid gap-6 border-t border-ink-100 px-5 py-4 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-medium text-ink-400">ブランド</p>
              <MasterChipManager
                kind="brand"
                items={brands.map((brand) => ({
                  id: brand.id,
                  code: brand.code,
                  name: brand.name,
                  productCount: brand._count.products,
                }))}
              />
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-ink-400">カテゴリ</p>
              <MasterChipManager
                kind="category"
                items={categories.map((category) => ({
                  id: category.id,
                  code: category.code,
                  name: category.name,
                  productCount: category._count.products,
                }))}
              />
            </div>
          </div>
        </details>
      )}

      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-400">品番・商品名・SKU</span>
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="26SS-SH-001 / シャツ"
              className="w-56 rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-ink-400"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-400">シーズン</span>
            <select
              name="season"
              defaultValue={params.season ?? ""}
              className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-ink-400"
            >
              <option value="">すべて</option>
              {seasons.map((season) => (
                <option key={season.id} value={season.code}>
                  {season.code} ({season.name})
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-400">カテゴリ</span>
            <select
              name="category"
              defaultValue={params.category ?? ""}
              className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-ink-400"
            >
              <option value="">すべて</option>
              {categories.map((category) => (
                <option key={category.id} value={category.code}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            className="rounded-lg bg-ink-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-ink-800"
          >
            絞り込む
          </button>
          <Link href="/products" className="px-2 py-1.5 text-sm text-ink-400 hover:text-ink-600">
            クリア
          </Link>
        </form>
      </Card>

      <Card>
        {rows.length ? (
          <Table
            minWidth={880}
            head={[
              "品番",
              "商品名",
              "シーズン",
              "カラー×サイズ",
              { label: "プロパー", align: "right" },
              { label: "現在価格", align: "right" },
              { label: "在庫", align: "right" },
            ]}
          >
            {rows.map(({ product, onHand, colors, sizes }) => {
              const phase = seasonPhase(product.season);
              const discount = markdownRate(product.listPrice, product.currentPrice);
              return (
                <tr key={product.id}>
                  <td className="px-2 py-2.5">
                    <Link
                      href={`/products/${product.id}`}
                      className="tabular text-sm font-medium text-ink-900 hover:text-accent"
                    >
                      {product.styleCode}
                    </Link>
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="font-medium text-ink-800">{product.name}</div>
                    <div className="text-xs text-ink-400">
                      {product.brand.name} · {product.category.name}
                    </div>
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="tabular text-sm">{product.season.code}</span>
                      <Badge
                        tone={phase === "PROPER" ? "success" : phase === "SALE" ? "warning" : "neutral"}
                      >
                        {SEASON_PHASE_LABEL[phase]}
                      </Badge>
                    </div>
                  </td>
                  <td className="tabular px-2 py-2.5 text-ink-600">
                    {colors} 色 × {sizes} サイズ
                    <span className="ml-1 text-xs text-ink-400">({product.variants.length})</span>
                  </td>
                  <td className="tabular px-2 py-2.5 text-right text-ink-400">
                    {discount > 0 ? (
                      <span className="line-through">{formatYen(product.listPrice)}</span>
                    ) : (
                      formatYen(product.listPrice)
                    )}
                  </td>
                  <td className="tabular px-2 py-2.5 text-right">
                    <span className={discount > 0 ? "font-semibold text-accent" : ""}>
                      {formatYen(product.currentPrice)}
                    </span>
                    {discount > 0 && (
                      <span className="ml-1 text-xs text-accent">-{formatPercent(discount, 0)}</span>
                    )}
                  </td>
                  <td className="tabular px-2 py-2.5 text-right font-medium">{onHand}</td>
                </tr>
              );
            })}
          </Table>
        ) : (
          <EmptyState message="該当する商品がありません" hint="検索条件を変えてお試しください" />
        )}
      </Card>
    </>
  );
}
