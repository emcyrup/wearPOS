import type { ProductField } from "@prisma/client";

import { prisma } from "@/lib/db";

/**
 * 商品の基本情報の組み込み項目。
 * ここに載っている項目は表示のオンオフだけができ、削除はできない。
 * カラー・サイズは SKU の構成要素のため、この設定の対象外 (常に表示)。
 */
export const BUILTIN_PRODUCT_FIELDS = [
  { key: "brand", label: "ブランド" },
  { key: "category", label: "カテゴリ" },
  { key: "season", label: "シーズン" },
  { key: "material", label: "素材・組成" },
  { key: "originCountry", label: "原産国" },
  { key: "careNote", label: "取扱い注意" },
] as const;

export type BuiltinFieldKey = (typeof BUILTIN_PRODUCT_FIELDS)[number]["key"];

/**
 * 項目設定を返す。組み込み項目の行が無ければ作る (初回アクセス時のセットアップ)。
 * 並びは組み込み → カスタム (作成順)。
 */
export async function ensureProductFields(): Promise<ProductField[]> {
  const existing = await prisma.productField.findMany();
  const byKey = new Map(existing.filter((f) => f.builtinKey).map((f) => [f.builtinKey, f]));

  for (const [index, def] of BUILTIN_PRODUCT_FIELDS.entries()) {
    if (!byKey.has(def.key)) {
      await prisma.productField.create({
        data: { builtinKey: def.key, label: def.label, sortOrder: index },
      });
    }
  }

  // 並びはユーザーが設定した sortOrder に従う (設定画面の ↑↓ で変更できる)
  return prisma.productField.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

/** 表示中の項目のみ */
export async function visibleProductFields(): Promise<ProductField[]> {
  return (await ensureProductFields()).filter((field) => field.isVisible);
}

/** 組み込み項目キー → 表示するかどうかのマップ */
export function builtinVisibility(fields: ProductField[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const def of BUILTIN_PRODUCT_FIELDS) {
    map[def.key] = fields.some((f) => f.builtinKey === def.key && f.isVisible);
  }
  return map;
}
