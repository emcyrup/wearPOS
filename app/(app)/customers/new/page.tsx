import Link from "next/link";

import { CustomerNewForm } from "@/components/customer-new-form";
import { PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function CustomerNewPage() {
  const stores = await prisma.store.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
  });

  return (
    <>
      <div className="mb-2">
        <Link href="/customers" className="text-sm text-ink-400 hover:text-ink-600">
          ← 顧客一覧
        </Link>
      </div>
      <PageHeader
        title="顧客の新規登録"
        description="店頭やお電話で伺った情報から顧客を登録します。LINE からの自己登録 (会員登録フォーム) とも同じ台帳に入ります"
      />
      <CustomerNewForm stores={stores.map((store) => ({ id: store.id, name: store.name }))} />
    </>
  );
}
