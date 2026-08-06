"use client";

import { useState, useTransition } from "react";

import { previewCampaign, sendCampaign } from "@/app/customers/actions";
import {
  CAMPAIGN_TARGETS,
  CAMPAIGN_TYPES,
  type CampaignResult,
  type CampaignTarget,
  type CampaignType,
} from "@/lib/campaign-options";

const selectClass =
  "rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-ink-400";

/**
 * LINE 一斉配信。対象セグメントとメッセージ種別を選び、
 * 対象人数を確認してから送信する。文面は1通ずつ購買傾向に合わせて生成される。
 */
export function LineCampaign() {
  const [target, setTarget] = useState<CampaignTarget>("dormant");
  const [type, setType] = useState<CampaignType>("revisit");
  const [count, setCount] = useState<number | null>(null);
  const [result, setResult] = useState<CampaignResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const check = () =>
    startTransition(async () => {
      setError(null);
      setResult(null);
      const res = await previewCampaign({ target, type });
      if (res.ok) {
        setCount(res.count ?? 0);
      } else {
        setError(res.error ?? "確認に失敗しました");
      }
    });

  const send = () =>
    startTransition(async () => {
      setError(null);
      const res = await sendCampaign({ target, type });
      if (res.ok && res.result) {
        setResult(res.result);
        setCount(null);
      } else {
        setError(res.error ?? "送信に失敗しました");
      }
    });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-sm text-ink-600">
          対象
          <select
            value={target}
            onChange={(event) => {
              setTarget(event.target.value as CampaignTarget);
              setCount(null);
              setResult(null);
            }}
            className={selectClass}
          >
            {CAMPAIGN_TARGETS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm text-ink-600">
          内容
          <select
            value={type}
            onChange={(event) => {
              setType(event.target.value as CampaignType);
              setCount(null);
              setResult(null);
            }}
            className={selectClass}
          >
            {CAMPAIGN_TYPES.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {count === null ? (
          <button
            type="button"
            onClick={check}
            disabled={pending}
            className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50 disabled:opacity-50"
          >
            {pending ? "確認中..." : "対象人数を確認"}
          </button>
        ) : (
          <>
            <span className="tabular text-sm font-medium text-ink-800">{count} 名が対象</span>
            <button
              type="button"
              onClick={send}
              disabled={pending || count === 0}
              className="rounded-lg bg-ink-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-40"
            >
              {pending ? "送信中..." : "送信する"}
            </button>
            <button
              type="button"
              onClick={() => setCount(null)}
              disabled={pending}
              className="text-xs text-ink-400 hover:text-ink-600"
            >
              キャンセル
            </button>
          </>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
      {result && (
        <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          対象 {result.targeted} 名中 {result.sent} 名に送信しました
          {result.failed > 0 && ` (失敗/スキップ ${result.failed} 件)`}
          {result.fallback > 0 && `。おすすめが作れなかった ${result.fallback} 名には再来店文面を送付`}
          。送受信ログは各顧客の詳細ページで確認できます。
        </p>
      )}
      <p className="mt-2 text-xs text-ink-400">
        文面は1通ずつ、お客様の購買傾向 (よく買うサイズ・カラー) と在庫に合わせて自動作成されます。
        送信対象は LINE 連携済みでブロックされていない会員のみ、1回の上限は 200 名です。
      </p>
    </div>
  );
}
