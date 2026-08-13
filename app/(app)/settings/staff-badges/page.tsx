import Link from "next/link";
import { redirect } from "next/navigation";

import { Barcode } from "@/components/barcode";
import { PrintButton } from "@/components/print-button";
import { PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/auth";
import { MULTI_STORE } from "@/lib/config";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * スタッフの名札バーコード印刷ページ (管理者用)。
 * スタッフコードを Code128 で印字し、レジの「担当スタッフ」欄で読み取って使う。
 */
export default async function StaffBadgesPage() {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") redirect("/settings");

  const staff = await prisma.staff.findMany({
    where: { isActive: true },
    include: { store: true },
    orderBy: { code: "asc" },
  });

  return (
    <>
      <div className="mb-2 print:hidden">
        <Link href="/settings" className="text-sm text-ink-400 hover:text-ink-600">
          ← 設定 / 連携
        </Link>
      </div>
      <div className="print:hidden">
        <PageHeader
          title="スタッフ名札バーコード"
          description="印刷して名札に入れておくと、レジの「担当スタッフ」欄のスキャンボタンで読み取ってすぐに担当者を選べます"
          action={<PrintButton />}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 print:grid-cols-3">
        {staff.map((person) => (
          <div
            key={person.id}
            className="flex flex-col items-center rounded-xl border border-ink-200 bg-white px-4 py-5 text-center print:break-inside-avoid print:rounded-none"
          >
            <p className="text-sm font-semibold text-ink-900">{person.name}</p>
            <p className="mt-0.5 text-[11px] text-ink-400">
              {MULTI_STORE ? `${person.store?.name ?? "全店舗"} · ${person.role}` : person.role}
            </p>
            <div className="mt-3">
              <Barcode code={person.code} moduleWidth={1.6} height={44} />
            </div>
          </div>
        ))}
      </div>
      {staff.length === 0 && (
        <p className="mt-6 text-center text-sm text-ink-400">有効なスタッフがいません</p>
      )}
    </>
  );
}
