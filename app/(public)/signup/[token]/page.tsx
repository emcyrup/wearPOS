import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SignupForm } from "@/components/signup-form";
import { getCustomerFieldPolicy } from "@/app/(app)/settings/customer-field-actions";
import { prisma } from "@/lib/db";
import { fullName } from "@/lib/format";
import { signMemberCardToken, verifySignupToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "会員登録 — wearPOS",
  robots: { index: false, follow: false },
};

/**
 * LINE の友だち追加時に配信される会員登録フォーム。
 * トークン (署名付き LINE ユーザー ID) が正当な場合のみ表示され、
 * 登録すると顧客が作成されてその LINE アカウントに紐付く。
 */
export default async function SignupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const lineUserId = await verifySignupToken(decodeURIComponent(token));
  if (!lineUserId) notFound();

  // 既に登録済みならフォームを出さず会員証へ誘導する
  const account = await prisma.lineAccount.findUnique({
    where: { lineUserId },
    include: { customer: true },
  });

  return (
    <div className="mx-auto w-full max-w-md py-4">
      <div className="mb-5 text-center">
        <p className="text-xl font-semibold tracking-tight text-ink-900">
          wear<span className="text-accent">POS</span>
        </p>
        <p className="mt-1 text-sm text-ink-500">
          {account ? "会員登録の確認" : "会員登録フォーム"}
        </p>
      </div>

      {account ? (
        <div className="rounded-xl border border-ink-200 bg-white p-6 text-center">
          <p className="text-sm text-ink-600">
            {fullName(account.customer)} 様として登録済みです
          </p>
          <p className="tabular mt-1 text-sm text-ink-400">
            会員番号: {account.customer.memberCode}
          </p>
          <a
            href={`/card/${await signMemberCardToken(account.customerId)}`}
            className="mt-5 block w-full rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink-800"
          >
            デジタル会員証を表示
          </a>
        </div>
      ) : (
        <SignupForm token={decodeURIComponent(token)} policy={await getCustomerFieldPolicy()} />
      )}
    </div>
  );
}
