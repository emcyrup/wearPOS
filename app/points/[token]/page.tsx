import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { rankLabel } from "@/lib/apparel";
import { prisma } from "@/lib/db";
import { formatDate, fullName } from "@/lib/format";
import { verifyMemberCardToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ポイント — wearPOS",
  robots: { index: false, follow: false },
};

const EVENT_LABEL: Record<string, string> = {
  EARN: "獲得",
  REDEEM: "利用",
  ADJUST: "調整",
};

/** リッチメニューの「ポイント」から開く、ポイント残高と直近の履歴 (ログイン不要・署名トークン) */
export default async function PointsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const customerId = await verifyMemberCardToken(decodeURIComponent(token));
  if (!customerId) notFound();

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: { pointEvents: { orderBy: { createdAt: "desc" }, take: 10 } },
  });
  if (!customer) notFound();

  return (
    <div className="mx-auto w-full max-w-sm py-4">
      <div className="overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-lg">
        <div className="bg-ink-900 px-5 py-4 text-white">
          <p className="text-sm font-semibold tracking-tight">
            wear<span className="text-accent">POS</span> ポイント
          </p>
        </div>
        <div className="px-5 py-5">
          <p className="text-center text-sm text-ink-600">{fullName(customer)} 様</p>
          <p className="tabular mt-2 text-center text-4xl font-semibold text-ink-900">
            {customer.points.toLocaleString("ja-JP")}
            <span className="ml-1 text-base font-normal text-ink-400">pt</span>
          </p>
          <p className="mt-1 text-center text-xs text-ink-400">
            {rankLabel(customer.rank)}会員 · 会員番号 {customer.memberCode}
          </p>

          <div className="mt-5 border-t border-ink-100 pt-4">
            <p className="mb-2 text-xs font-medium text-ink-400">最近のポイント履歴</p>
            {customer.pointEvents.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-400">履歴はまだありません</p>
            ) : (
              <ul className="space-y-2">
                {customer.pointEvents.map((event) => (
                  <li key={event.id} className="flex items-center justify-between text-sm">
                    <span className="text-ink-500">
                      {formatDate(event.createdAt)}
                      <span className="ml-2 text-xs text-ink-400">
                        {EVENT_LABEL[event.type] ?? event.type}
                      </span>
                    </span>
                    <span
                      className={`tabular font-medium ${
                        event.points >= 0 ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      {event.points >= 0 ? "+" : ""}
                      {event.points.toLocaleString("ja-JP")} pt
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <a
            href={`/card/${decodeURIComponent(token)}`}
            className="mt-5 block w-full rounded-lg bg-ink-900 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-ink-800"
          >
            デジタル会員証を表示
          </a>
        </div>
      </div>
    </div>
  );
}
