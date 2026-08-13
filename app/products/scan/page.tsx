import Link from "next/link";

import { PageHeader } from "@/components/ui";
import { ScanLookup } from "@/components/scan-lookup";

export const dynamic = "force-dynamic";

export default function ScanPage() {
  return (
    <>
      <div className="mb-2">
        <Link href="/products" className="text-sm text-ink-400 hover:text-ink-600">
          ← 商品 / SKU
        </Link>
      </div>
      <PageHeader
        title="バーコードスキャン"
        description="値札の JAN コードや SKU を読み取って、商品情報と店舗別在庫を確認します"
      />
      <ScanLookup />
    </>
  );
}
