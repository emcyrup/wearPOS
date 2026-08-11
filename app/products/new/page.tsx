import Link from "next/link";
import { notFound } from "next/navigation";

import { ProductForm } from "@/components/product-form";
import { PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** 商品 (品番) の新規登録。管理者のみ */
export default async function NewProductPage() {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") notFound();

  const [brands, categories, seasons, stores] = await Promise.all([
    prisma.brand.findMany({ orderBy: { code: "asc" } }),
    prisma.category.findMany({ orderBy: { code: "asc" } }),
    prisma.season.findMany({ where: { isArchived: false }, orderBy: [{ year: "desc" }, { term: "asc" }] }),
    prisma.store.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
  ]);

  return (
    <>
      <div className="mb-2">
        <Link href="/products" className="text-sm text-ink-400 hover:text-ink-600">
          ← 商品 / SKU
        </Link>
      </div>
      <PageHeader
        title="商品を登録"
        description="カラー×サイズの SKU を一括で作成し、JAN コードの採番と初期在庫まで登録します"
      />
      <ProductForm
        brands={brands.map((brand) => ({ id: brand.id, name: brand.name }))}
        categories={categories.map((category) => ({ id: category.id, name: category.name }))}
        seasons={seasons.map((season) => ({
          id: season.id,
          name: season.name,
          code: season.code,
        }))}
        stores={stores.map((store) => ({ id: store.id, name: store.name }))}
      />
    </>
  );
}
