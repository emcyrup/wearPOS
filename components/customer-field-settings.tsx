"use client";

import { useState, useTransition } from "react";

import {
  updateCustomerFieldPolicy,
  type CustomerFieldState,
} from "@/app/(app)/settings/customer-field-actions";
import {
  CUSTOMER_FIELD_KEYS,
  CUSTOMER_FIELD_LABELS,
  CUSTOMER_FIELD_NOTES,
  MINIMAL_CUSTOMER_FIELD_POLICY,
  DEFAULT_CUSTOMER_FIELD_POLICY,
  type CustomerFieldKey,
  type CustomerFieldPolicy,
  type FieldMode,
} from "@/lib/customer-fields";

const MODES: { value: FieldMode; label: string }[] = [
  { value: "REQUIRED", label: "必須" },
  { value: "OPTIONAL", label: "任意" },
  { value: "HIDDEN", label: "集めない" },
];

/**
 * 顧客登録で集める項目の設定。
 * 店頭の登録フォームと LINE の登録フォームの両方に反映される。
 */
export function CustomerFieldSettings({ policy: initial }: { policy: CustomerFieldPolicy }) {
  const [policy, setPolicy] = useState(initial);
  const [state, setState] = useState<CustomerFieldState>({ status: "idle", message: "" });
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(policy) !== JSON.stringify(initial);

  const setMode = (key: CustomerFieldKey, mode: FieldMode) =>
    setPolicy((prev) => ({ ...prev, [key]: mode }));

  return (
    <div>
      {/* よく使う組み合わせをすぐ選べるようにする */}
      <div className="mb-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setPolicy(DEFAULT_CUSTOMER_FIELD_POLICY)}
          className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50"
        >
          標準にする
        </button>
        <button
          type="button"
          onClick={() => setPolicy(MINIMAL_CUSTOMER_FIELD_POLICY)}
          className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50"
        >
          最小構成にする (お名前・市区町村・性別・誕生日)
        </button>
      </div>

      {/* 氏名 */}
      <div className="rounded-lg border border-ink-200 p-3">
        <p className="text-sm font-medium text-ink-800">お名前</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          {(
            [
              { value: "FULL", label: "姓と名で登録する" },
              { value: "NICKNAME", label: "お名前1欄だけ (ニックネーム可)" },
            ] as const
          ).map((option) => (
            <label key={option.value} className="flex items-center gap-1.5 text-sm text-ink-600">
              <input
                type="radio"
                name="nameMode"
                checked={policy.nameMode === option.value}
                onChange={() => setPolicy((prev) => ({ ...prev, nameMode: option.value }))}
                className="h-4 w-4 accent-ink-900"
              />
              {option.label}
            </label>
          ))}
          <label className="flex items-center gap-1.5 text-sm whitespace-nowrap text-ink-600">
            <input
              type="checkbox"
              checked={policy.nameRequired}
              onChange={(event) =>
                setPolicy((prev) => ({ ...prev, nameRequired: event.target.checked }))
              }
              className="h-4 w-4 accent-ink-900"
            />
            必須にする
          </label>
        </div>
      </div>

      {/* そのほかの項目 */}
      <div className="mt-2 space-y-2">
        {CUSTOMER_FIELD_KEYS.map((key) => (
          <div key={key} className="rounded-lg border border-ink-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink-800">
                  {CUSTOMER_FIELD_LABELS[key]}
                </span>
                {CUSTOMER_FIELD_NOTES[key] && policy[key] === "HIDDEN" && (
                  <span className="mt-0.5 block text-xs text-amber-700">
                    {CUSTOMER_FIELD_NOTES[key]}
                  </span>
                )}
              </span>
              <span className="flex gap-1">
                {MODES.map((mode) => (
                  <button
                    key={mode.value}
                    type="button"
                    onClick={() => setMode(key, mode.value)}
                    aria-label={`${CUSTOMER_FIELD_LABELS[key]} を${mode.label}にする`}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                      policy[key] === mode.value
                        ? "border-ink-900 bg-ink-900 text-white"
                        : "border-ink-200 bg-white text-ink-600 hover:bg-ink-50"
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </span>
            </div>

            {key === "address" && policy.address !== "HIDDEN" && (
              <label className="mt-2 flex items-center gap-1.5 text-sm text-ink-600">
                <input
                  type="checkbox"
                  checked={policy.addressCityOnly}
                  onChange={(event) =>
                    setPolicy((prev) => ({ ...prev, addressCityOnly: event.target.checked }))
                  }
                  className="h-4 w-4 accent-ink-900"
                />
                市区町村までにする (番地・建物名は集めない)
              </label>
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() =>
            startTransition(async () => setState(await updateCustomerFieldPolicy(policy)))
          }
          disabled={pending || !dirty}
          className="rounded-lg bg-ink-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-40"
        >
          {pending ? "保存中..." : "保存する"}
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
    </div>
  );
}
