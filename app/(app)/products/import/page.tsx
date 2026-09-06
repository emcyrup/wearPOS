import Link from "next/link";

import { ProductCsvImport } from "@/components/product-csv-import";
import { Card, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { MULTI_STORE } from "@/lib/config";
import { prisma } from "@/lib/db";
import { CSV_SAMPLE } from "@/lib/product-csv";

export const dynamic = "force-dynamic";

export default async function ProductImportPage() {
  const isAdmin = Boolean(await requireAdmin());

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="CSV 一括取込" />
        <Card>
          <p className="text-sm text-ink-600">この画面は管理者のみ利用できます。</p>
        </Card>
      </>
    );
  }

  const stores = await prisma.store.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });

  return (
    <>
      <div className="mb-2">
        <Link href="/products" className="text-sm text-ink-400 hover:text-ink-600">
          ← 商品 / SKU
        </Link>
      </div>

      <PageHeader
        title="CSV 一括取込"
        description="仕入先からもらった JAN 付きの商品リストをそのまま取り込めます"
      />

      <ProductCsvImport
        stores={stores}
        multiStore={MULTI_STORE}
        sample={CSV_SAMPLE}
      />
    </>
  );
}
