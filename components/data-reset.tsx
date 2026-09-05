"use client";

import { useState, useTransition } from "react";

import { resetData, type DataResetState } from "@/app/(app)/settings/data-reset-actions";
import {
  expandTargets,
  RESET_CONFIRM_PHRASE,
  RESET_TARGETS,
  type ResetCounts,
  type ResetTargetKey,
} from "@/lib/data-reset";

/**
 * テストデータの一括削除。
 * 取り消せないので、対象の選択 → 件数の確認 → 確認フレーズの入力、の順に進ませる。
 */
export function DataReset({ counts }: { counts: ResetCounts }) {
  const [selected, setSelected] = useState<ResetTargetKey[]>([]);
  const [confirmText, setConfirmText] = useState("");
  const [state, setState] = useState<DataResetState>({ status: "idle", message: "" });
  const [pending, startTransition] = useTransition();

  const toggle = (key: ResetTargetKey) =>
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  // 商品を消すと在庫と取引も必ず消えるため、画面上でも連動して見せる
  const effective = expandTargets(selected);

  const ready = selected.length > 0 && confirmText.trim() === RESET_CONFIRM_PHRASE;

  const run = () => {
    startTransition(async () => {
      const result = await resetData({ targets: selected, confirmText });
      setState(result);
      if (result.status === "success") {
        setSelected([]);
        setConfirmText("");
      }
    });
  };

  return (
    <div>
      <div className="space-y-2">
        {RESET_TARGETS.map((target) => {
          const checked = selected.includes(target.key);
          const auto = !checked && effective.has(target.key);
          return (
            <label
              key={target.key}
              className={`flex cursor-pointer gap-2.5 rounded-lg border p-3 transition-colors ${
                checked || auto ? "border-rose-300 bg-rose-50/60" : "border-ink-200 hover:bg-ink-50"
              }`}
            >
              <input
                type="checkbox"
                checked={checked || auto}
                disabled={auto}
                onChange={() => toggle(target.key)}
                aria-label={`${target.label} を削除する`}
                className="mt-0.5 h-4 w-4 shrink-0 accent-rose-600"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink-800">
                  {target.label}
                  <span className="tabular ml-2 text-xs font-normal text-ink-400">
                    {counts[target.key].toLocaleString("ja-JP")} 件
                  </span>
                  {auto && <span className="ml-2 text-xs text-rose-700">商品の削除に伴い一緒に消えます</span>}
                </span>
                <span className="mt-0.5 block text-xs text-ink-400">{target.description}</span>
              </span>
            </label>
          );
        })}
      </div>

      {selected.length > 0 && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3">
          <p className="text-sm font-medium text-rose-800">
            この操作は取り消せません。実行前にバックアップを確認してください。
          </p>
          <label className="mt-2.5 block">
            <span className="mb-1 block text-xs text-rose-800">
              確認のため「{RESET_CONFIRM_PHRASE}」と入力してください
            </span>
            <input
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              aria-label="確認フレーズ"
              placeholder={RESET_CONFIRM_PHRASE}
              className="w-full max-w-xs rounded-lg border border-rose-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-rose-500"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              const labels = RESET_TARGETS.filter((t) => effective.has(t.key))
                .map((t) => t.label)
                .join(" / ");
              if (!window.confirm(`次のデータを削除します。よろしいですか？\n\n${labels}`)) return;
              run();
            }}
            disabled={pending || !ready}
            className="mt-3 rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-800 disabled:opacity-40"
          >
            {pending ? "削除中..." : "選択したデータを削除する"}
          </button>
        </div>
      )}

      {state.status !== "idle" && (
        <p
          className={`mt-3 text-sm ${
            state.status === "success" ? "text-emerald-700" : "text-rose-700"
          }`}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
