import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Barcode } from "@/components/barcode";
import { rankLabel } from "@/lib/apparel";
import { prisma } from "@/lib/db";
import { fullName } from "@/lib/format";
import { verifyMemberCardToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "会員証 — wearPOS",
  robots: { index: false, follow: false },
};

/**
 * デジタル会員証。
 * お客様の LINE に送るリンク先で、ログイン不要 (トークン署名で保護)。
 * レジの会員照会でこのバーコードをスキャンすると会員が紐づく。
 */
export default async function MemberCardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const customerId = await verifyMemberCardToken(decodeURIComponent(token));
  if (!customerId) notFound();

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) notFound();

  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <div className="w-full max-w-xs">
        <div className="overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-lg">
          <div className="bg-ink-900 px-5 py-4 text-white">
            <p className="text-sm font-semibold tracking-tight">
              wear<span className="text-accent">POS</span> メンバーズカード
            </p>
          </div>
          <div className="px-5 py-5 text-center">
            <p className="text-base font-semibold text-ink-900">{fullName(customer)} 様</p>
            <p className="mt-1 text-xs text-ink-400">
              {rankLabel(customer.rank)} 会員 · {customer.points.toLocaleString("ja-JP")} pt
            </p>
            <div className="mt-4 flex justify-center">
              <Barcode code={customer.memberCode} moduleWidth={2} height={64} />
            </div>
            <p className="mt-4 text-xs leading-relaxed text-ink-400">
              お会計の際に、この画面をレジでご提示ください
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
