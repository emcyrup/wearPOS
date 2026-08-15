"use client";

import { useState, useTransition } from "react";

import { updateSignupPolicy, type UserActionState } from "@/app/(app)/settings/user-actions";
import type { SignupMode } from "@/lib/signup-policy";

const MODES: { value: SignupMode; label: string; hint: string }[] = [
  {
    value: "OPEN",
    label: "だれでも作成できる",
    hint: "ログイン画面を開いた人は誰でもスタッフ用ユーザーを作れます",
  },
  {
    value: "CODE",
    label: "合言葉が必要",
    hint: "店舗で共有した合言葉を入力した人だけ作成できます",
  },
  {
    value: "OFF",
    label: "作成させない",
    hint: "ユーザーの追加はこの設定画面からのみ行います",
  },
];

/**
 * ログイン画面からの新規ユーザー作成の可否設定。
 * 作成されるのは常にスタッフ権限 + 既定機能なので、顧客情報や設定は見られない。
 */
export function SignupPolicySettings({
  mode: initialMode,
  hasCode,
}: {
  mode: SignupMode;
  hasCode: boolean;
}) {
  const [mode, setMode] = useState<SignupMode>(initialMode);
  const [code, setCode] = useState("");
  const [state, setState] = useState<UserActionState>({ status: "idle", message: "" });
  const [pending, startTransition] = useTransition();

  const dirty = mode !== initialMode || code.trim() !== "";

  const save = () => {
    startTransition(async () => {
      const result = await updateSignupPolicy({ mode, code: code.trim() });
      setState(result);
      if (result.status === "success") setCode("");
    });
  };

  return (
    <div>
      <div className="space-y-2">
        {MODES.map((option) => (
          <label
            key={option.value}
            className={`flex cursor-pointer gap-2.5 rounded-lg border p-3 transition-colors ${
              mode === option.value
                ? "border-ink-900 bg-ink-50/60"
                : "border-ink-200 hover:bg-ink-50"
            }`}
          >
            <input
              type="radio"
              name="signupMode"
              checked={mode === option.value}
              onChange={() => setMode(option.value)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-ink-900"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink-800">{option.label}</span>
              <span className="mt-0.5 block text-xs text-ink-400">{option.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {mode === "CODE" && (
        <label className="mt-3 block">
          <span className="mb-1 block text-xs text-ink-400">
            合言葉 {hasCode ? "(変更するときだけ入力)" : "(4文字以上)"}
          </span>
          <input
            type="text"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder={hasCode ? "設定済み" : "例: wearpos2026"}
            className="w-full max-w-xs rounded-lg border border-ink-200 px-2.5 py-1.5 text-sm outline-none focus:border-ink-400 sm:w-64"
          />
        </label>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
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

      {mode === "OPEN" && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          アプリの URL を知っている人は誰でもユーザーを作成できます。
          店舗の外に URL が出ている場合は「合言葉が必要」または「作成させない」をおすすめします。
        </p>
      )}
    </div>
  );
}
