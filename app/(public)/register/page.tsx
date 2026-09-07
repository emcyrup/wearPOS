import { Register } from "@/components/register";
import { RegisterUnlock } from "@/components/register-unlock";
import { PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { activePaymentMethods } from "@/lib/payment-methods";
import { hasRegisterAccess, hasRegisterCode } from "@/lib/register-access";
import { listActiveStores } from "@/lib/stores";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  // レジは店頭端末でログインなしに使うため、端末そのものを一度だけ認可する。
  // 未認可のまま会員検索や会計ができると、URL を知っているだけで顧客情報を引けてしまう
  if (!(await hasRegisterAccess())) {
    return <RegisterUnlock codeConfigured={await hasRegisterCode()} />;
  }

  const [stores, staff, paymentMethods] = await Promise.all([
    // 店舗が1つも無いと会計できないため、初回はここで既定の店舗を用意する
    listActiveStores(),
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
