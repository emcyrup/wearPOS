import { PageHeader } from "@/components/ui";
import { ScanLookup } from "@/components/scan-lookup";

export const dynamic = "force-dynamic";

export default function ScanPage() {
  return (
    <>
      <PageHeader
        title="バーコードスキャン"
        description="値札の JAN コードや SKU を読み取って、商品情報と店舗別在庫を確認します"
      />
      <ScanLookup />
    </>
  );
}
