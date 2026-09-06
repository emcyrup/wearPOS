import Link from "next/link";
import { notFound } from "next/navigation";

import {
  countResetTargets,
  isDataResetEnabled,
  recentDataResets,
} from "@/app/(app)/settings/data-reset-actions";
import { DataReset } from "@/components/data-reset";
import { Card, EmptyState, PageHeader, Table } from "@/components/ui";
import { getSessionUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

/** テストデータの一括削除 (管理者のみ) */
export default async function DataResetPage() {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") notFound();

  const [counts, history, enabled] = await Promise.all([
    countResetTargets(),
    recentDataResets(),
    isDataResetEnabled(),
  ]);
  if (!counts) notFound();

  return (
    <>
      <div className="mb-2">
        <Link href="/settings" className="text-sm text-ink-400 hover:text-ink-600">
          ← 設定 / 連携
        </Link>
      </div>

      <PageHeader
        title="データの初期化"
        description="動作確認用に入れたデータを消して、本番運用を始めるための機能です"
      />

      {!enabled && (
        <p className="mb-4 rounded-lg bg-ink-50 px-4 py-2.5 text-sm text-ink-600">
          この機能は<span className="font-medium">既定で無効</span>です。設定画面の
          「初期化画面を開く」ボタンもグレーアウトしており、
          <span className="font-medium">有効化は運用担当者が行います</span>。
          店舗での作業でこの画面が必要になった場合は、運用担当者にご連絡ください。
        </p>
      )}

      <Card title="削除するデータを選ぶ" className="mb-4">
        <p className="mb-3 text-sm text-ink-600">
          選んだデータを<span className="font-medium text-rose-700">完全に削除</span>します。
          元に戻すことはできません。棚卸や本番開始のタイミングで、テストデータだけを消す用途を想定しています。
          店舗・スタッフ・商品の項目設定・ユーザーなどのマスタは消えません。
        </p>
        <DataReset counts={counts} enabled={enabled} />
      </Card>

      <Card title="実行履歴">
        {history.length ? (
          <Table head={["日時", "実行者", "内容"]} minWidth={560}>
            {history.map((log) => (
              <tr key={log.id} className="border-b border-ink-100 last:border-0">
                <td className="tabular px-2 py-2 whitespace-nowrap text-xs text-ink-400">
                  {formatDateTime(log.createdAt)}
                </td>
                <td className="px-2 py-2 text-ink-800">{log.actorName}</td>
                <td className="px-2 py-2 text-xs break-all text-ink-500">{log.detail}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState message="データの初期化はまだ実行されていません" />
        )}
      </Card>
    </>
  );
}
