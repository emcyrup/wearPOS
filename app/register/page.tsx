import { Register } from "@/components/register";
import { PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const [stores, staff] = await Promise.all([
    prisma.store.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
    prisma.staff.findMany({
      where: { isActive: true },
      include: { store: true },
      orderBy: { code: "asc" },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="レジ"
        description="バーコードをスキャンして商品を追加し、その場で会計します。在庫・顧客実績・ポイントに即時反映されます"
      />
      <Register
        stores={stores.map((store) => ({ code: store.code, name: store.name }))}
        staff={staff.map((s) => ({
          code: s.code,
          name: s.name,
          storeCode: s.store?.code ?? null,
        }))}
      />
    </>
  );
}
