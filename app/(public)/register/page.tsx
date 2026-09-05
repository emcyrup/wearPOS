import { Register } from "@/components/register";
import { PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { activePaymentMethods } from "@/lib/payment-methods";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const [stores, staff, paymentMethods] = await Promise.all([
    prisma.store.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
    prisma.staff.findMany({
      where: { isActive: true },
      include: { store: true },
      orderBy: { code: "asc" },
    }),
    activePaymentMethods(),
  ]);

  return (
    // レジ専用タブ想定のため、サイドバーなしの全幅レイアウトで表示する
    <div className="mx-auto max-w-6xl">
      <p className="mb-1 text-sm font-semibold tracking-tight text-ink-400">
        wear<span className="text-accent">POS</span>
      </p>
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
        paymentMethods={paymentMethods.map((method) => ({
          code: method.code,
          label: method.label,
          allowChange: method.allowChange,
          allowSplit: method.allowSplit,
        }))}
      />
    </div>
  );
}
