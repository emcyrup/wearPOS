import Link from "next/link";
import { notFound } from "next/navigation";

import { ReminderTest } from "@/components/reminder-test";
import { PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/auth";
import { isLineConfigured } from "@/lib/line";
import { REMINDER_RULE_DEFS } from "@/lib/reminders";

export const dynamic = "force-dynamic";

/** リマインドのテスト配信ページ (管理者のみ) */
export default async function ReminderTestPage() {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") notFound();

  return (
    <>
      <div className="mb-2">
        <Link href="/settings" className="text-sm text-ink-400 hover:text-ink-600">
          ← 設定 / 連携
        </Link>
      </div>
      <PageHeader
        title="リマインドのテスト配信"
        description="顧客とルールを選んで、実際に送られる文面の確認と本人の LINE へのテスト送信ができます"
      />

      {!isLineConfigured() && (
        <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          LINE の認証情報が未設定のため、テスト送信は実送信されずログのみ記録されます
          (文面のプレビューは利用できます)。
        </p>
      )}

      <ReminderTest rules={REMINDER_RULE_DEFS.map((def) => ({ key: def.key, label: def.label }))} />

      <p className="mt-4 text-xs text-ink-400">
        テスト送信はテンプレート「REMINDER_TEST」として記録され、文面の先頭に【テスト配信】が付きます。
        本番の自動リマインドの「1回のご来店につき1通」などの重複判定には影響しません。
        送信結果は各顧客詳細ページの送受信ログでも確認できます。
      </p>
    </>
  );
}
