"use client";

import { useState, useTransition } from "react";

import { applyRichMenu, type RichMenuResult } from "@/app/(app)/settings/line-actions";

/**
 * リッチメニューの適用ボタン。
 * トーク下部に「会員登録 / 会員証 / ポイント」のメニューを表示し、
 * タップでキーワードが送信される (本人専用 URL は Webhook が返すため誤送信がない)。
 */
export function RichMenuSetup() {
  const [result, setResult] = useState<RichMenuResult | null>(null);
  const [pending, startTransition] = useTransition();

  const apply = () =>
    startTransition(async () => {
      setResult(await applyRichMenu());
    });

  return (
    <div className="mt-3 border-t border-ink-100 pt-3">
      <p className="mb-1.5 text-xs font-medium text-ink-400">リッチメニュー</p>
      <p className="mb-2 text-sm text-ink-600">
        トーク画面の下部に「会員登録・会員証・ポイント」のメニューを表示します。
        タップするとキーワードが送信され、本人専用のリンクや情報が自動返信されます。
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <img
          src="/line-richmenu.png"
          alt="リッチメニューのプレビュー"
          className="w-56 rounded-lg border border-ink-200"
        />
        <button
          type="button"
          onClick={apply}
          disabled={pending}
          className="rounded-lg bg-ink-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-50"
        >
          {pending ? "適用中..." : "リッチメニューを適用"}
        </button>
      </div>
      {result && (
        <p
          className={`mt-2 rounded-lg px-3 py-2 text-sm ${
            result.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"
          }`}
        >
          {result.ok
            ? result.mode === "liff"
              ? "リッチメニューを適用しました (タップで直接画面が開きます)。トーク画面を開き直すと表示されます"
              : "リッチメニューを適用しました (キーワード送信方式)。LIFF_ID / LIFF_CHANNEL_ID を設定して再適用すると、タップで直接画面が開くようになります"
            : result.error}
        </p>
      )}
    </div>
  );
}
