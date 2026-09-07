"use client";

import { useState, useTransition } from "react";

import {
  updateRegisterCode,
  type RegisterAccessState,
} from "@/app/(app)/settings/register-access-actions";

/**
 * レジ端末のアクセス設定。
 * レジはログインなしで開けるようにしているため、端末そのものを認可する仕組みを持つ。
 */
export function RegisterAccessSettings({ codeConfigured }: { codeConfigured: boolean }) {
  const [code, setCode] = useState("");
  const [state, setState] = useState<RegisterAccessState>({ status: "idle", message: "" });
  const [pending, startTransition] = useTransition();

  const save = (value: string) =>
    startTransition(async () => {
      const result = await updateRegisterCode(value);
      setState(result);
      if (result.status === "success") setCode("");
    });

  return (
    <div>
      <div
        className={`rounded-lg border p-3 ${
          codeConfigured ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/60"
        }`}
      >
        <p className="text-sm font-medium text-ink-800">
          {codeConfigured
            ? "レジ端末コード: 設定済み"
            : "レジ端末コード: 未設定（レジはログインした人だけが使えます）"}
        </p>
        <p className="mt-1 text-xs text-ink-600">
          {codeConfigured
            ? "店頭の端末でレジを開き、このコードを一度入力すると、以降はログインなしで使えます"
            : "コードを決めると、店頭の端末をログインなしで使えるようになります"}
        </p>
      </div>

      <label className="mt-3 block">
        <span className="mb-1 block text-xs text-ink-500">
          {codeConfigured ? "新しいレジ端末コード" : "レジ端末コード"}（4文字以上）
        </span>
        <input
          type="password"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          autoComplete="new-password"
          placeholder="店頭の端末で入力してもらう合言葉"
          className="w-full max-w-sm rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-400"
        />
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => save(code)}
          disabled={pending || code.trim().length === 0}
          className="rounded-lg bg-ink-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-40"
        >
          {pending ? "保存中..." : codeConfigured ? "コードを変更する" : "コードを設定する"}
        </button>
        {codeConfigured && (
          <button
            type="button"
            onClick={() => {
              if (
                !window.confirm(
                  "レジ端末コードを解除します。\nレジはログインした人だけが使えるようになります。よろしいですか？",
                )
              ) {
                return;
              }
              save("");
            }}
            disabled={pending}
            className="rounded-lg border border-ink-200 bg-white px-4 py-1.5 text-sm text-ink-600 hover:bg-ink-50 disabled:opacity-40"
          >
            解除する
          </button>
        )}
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

      <p className="mt-3 text-xs text-ink-400">
        コードを変更すると、いま認可されている端末はそのまま使えます。
        端末を入れ替えたときは新しいコードを入力してください
      </p>
    </div>
  );
}
