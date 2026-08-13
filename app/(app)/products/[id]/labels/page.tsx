import Link from "next/link";
import { notFound } from "next/navigation";

import { Barcode } from "@/components/barcode";
import { PrintButton } from "@/components/print-button";
import { prisma } from "@/lib/db";
import { formatYen } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * 値札ラベルの印刷ページ。
 * SKU ごとに「商品名 / カラー・サイズ / 価格 / バーコード」のラベルを並べ、
 * ブラウザの印刷機能でラベル用紙に出力する。
 */
export default async function ProductLabelsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ copies?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  // 1ラベルあたりの枚数 (在庫分だけ印刷したい場合に増やす)
  const copies = Math.min(Math.max(1, Number(query.copies) || 1), 20);

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      brand: true,
      variants: {
        where: { isActive: true },
        orderBy: [{ colorCode: "asc" }, { sizeOrder: "asc" }],
      },
    },
  });

  if (!product) notFound();

  const labels = product.variants.flatMap((variant) =>
    Array.from({ length: copies }, (_, i) => ({ variant, key: `${variant.id}-${i}` })),
  );

  return (
    <>
      {/* 画面表示時のみのヘッダー。印刷時は消す */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <Link href={`/products/${product.id}`} className="text-sm text-ink-400 hover:text-ink-600">
            ← {product.name}
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">値札ラベル印刷</h1>
          <p className="mt-1 text-sm text-ink-400">
            {product.styleCode} · {product.variants.length} SKU × {copies} 枚
          </p>
        </div>
        <div className="flex items-center gap-3">
          <form method="get" className="flex items-center gap-2">
            <label className="text-sm text-ink-400" htmlFor="copies">
              枚数/SKU
            </label>
            <input
              id="copies"
              type="number"
              name="copies"
              min={1}
              max={20}
              defaultValue={copies}
              className="tabular w-16 rounded-lg border border-ink-200 px-2 py-1.5 text-sm"
            />
            <button
              type="submit"
              className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50"
            >
              反映
            </button>
          </form>
          <PrintButton />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 print:grid-cols-3 print:gap-2">
        {labels.map(({ variant, key }) => (
          <div
            key={key}
            className="break-inside-avoid rounded-lg border border-ink-200 bg-white p-3 text-center print:rounded-none print:border-ink-400"
          >
            <p className="truncate text-[11px] text-ink-400">{product.brand.name}</p>
            <p className="truncate text-xs font-medium text-ink-900">{product.name}</p>
            <p className="mt-0.5 text-[11px] text-ink-600">
              {variant.colorName} / {variant.sizeName}
            </p>
            <p className="tabular mt-0.5 text-sm font-semibold">
              {formatYen(product.currentPrice)}
              <span className="ml-1 text-[10px] font-normal text-ink-400">(税抜)</span>
            </p>
            <div className="mt-1.5 flex justify-center">
              <Barcode code={variant.barcode ?? variant.sku} moduleWidth={1.6} height={36} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
