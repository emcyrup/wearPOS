"use client";

import { useState, useTransition } from "react";

import {
  testAiConnection,
  updateChatGptEnabled,
  type AiConnectionResult,
  type AiSettingState,
} from "@/app/(app)/settings/ai-actions";

/**
 * AI考察の設定。
 * 「何を外部に送っているか」を明記し、ChatGPT への送信を止められるようにする。
 * 接続テストでエラー本文を確認できるため、IP 制限などの切り分けにも使える。
 */
export function AiSettings({
  chatGptEnabled: initialEnabled,
  chatGptConfigured,
  anthropicConfigured,
}: {
  chatGptEnabled: boolean;
  chatGptConfigured: boolean;
  anthropicConfigured: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [state, setState] = useState<AiSettingState>({ status: "idle", message: "" });
  const [results, setResults] = useState<AiConnectionResult[] | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div>
      <div className="rounded-lg border border-ink-200 bg-ink-50/60 p-3">
        <p className="text-xs font-medium text-ink-500">AI に送っているデータ</p>
        <ul className="mt-1.5 space-y-1 text-xs text-ink-600">
          <li>・売上・客数・客単価・消化率などの<span className="font-medium">集計値</span></li>
          <li>・日別の売上推移、カラー / サイズ / シーズン別の販売構成、売れ筋 SKU</li>
          <li>・顧客は<span className="font-medium">統計のみ</span>（会員数・新規数・リピート率・休眠数・LINE 連携数・ランク分布）</li>
          <li>・スタッフ実績（<span className="font-medium">氏名は「スタッフA」等に置換</span>して送信し、画面表示で実名に戻します）</li>
        </ul>
        <p className="mt-2 text-xs font-medium text-emerald-700">
          顧客の氏名・カナ・電話番号・メール・住所・誕生日・個別の購入履歴は送信していません。
        </p>
        <p className="mt-1 text-xs text-ink-400">
          実際の送信内容は、ダッシュボードの AI考察にある「AIに送るデータを見る」でいつでも確認できます。
        </p>
      </div>

      <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-ink-200 p-3">
        <input
          type="checkbox"
          checked={enabled}
          disabled={pending || !chatGptConfigured}
          onChange={(event) => {
            const next = event.target.checked;
            setEnabled(next);
            startTransition(async () => setState(await updateChatGptEnabled(next)));
          }}
          className="mt-0.5 h-4 w-4 shrink-0 accent-ink-900"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-ink-800">
            ChatGPT (OpenAI) にもデータを送って討論させる
          </span>
          <span className="mt-0.5 block text-xs text-ink-400">
            {chatGptConfigured
              ? "オフにすると、送信先は Anthropic (Claude) だけになります。考察は Claude 単独で行います"
              : "OPENAI_API_KEY が未設定のため、現在は Claude 単独で考察しています"}
          </span>
        </span>
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => startTransition(async () => setResults(await testAiConnection()))}
          disabled={pending}
          className="rounded-lg border border-ink-200 bg-white px-4 py-1.5 text-sm font-medium whitespace-nowrap text-ink-600 hover:bg-ink-50 disabled:opacity-40"
        >
          {pending ? "確認中..." : "AI接続テスト"}
        </button>
        {state.status !== "idle" && (
          <p
            className={`text-xs ${
              state.status === "success" ? "text-emerald-700" : "text-rose-700"
            }`}
          >
            {state.message}
          </p>
        )}
      </div>

      {results && (
        <div className="mt-3 space-y-2">
          {results.map((result) => (
            <div
              key={result.provider}
              className={`rounded-lg border p-3 ${
                result.ok
                  ? "border-emerald-200 bg-emerald-50/60"
                  : result.configured
                    ? "border-rose-200 bg-rose-50/60"
                    : "border-ink-200 bg-ink-50"
              }`}
            >
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-800">
                {result.provider}
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    result.ok
                      ? "bg-emerald-100 text-emerald-800"
                      : result.configured
                        ? "bg-rose-100 text-rose-800"
                        : "bg-ink-100 text-ink-600"
                  }`}
                >
                  {result.ok ? "接続OK" : result.configured ? "エラー" : "未設定"}
                </span>
                {result.ms !== null && (
                  <span className="tabular text-xs font-normal text-ink-400">{result.ms} ms</span>
                )}
              </p>
              <p className="mt-1 text-xs break-all text-ink-600">{result.detail}</p>
            </div>
          ))}
          <p className="text-xs text-ink-400">
            エラー本文はそのまま表示しています。「IP」「region」などの記載がある場合は、
            API キー側のアクセス制限や利用地域の制限が原因のことがあります。
          </p>
        </div>
      )}

      {!anthropicConfigured && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ANTHROPIC_API_KEY が未設定のため、AI考察は利用できません。
        </p>
      )}
    </div>
  );
}
