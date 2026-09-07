"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { unlockRegister } from "@/app/(public)/register/actions";

/**
 * レジ端末の認可画面。
 * 店頭の端末で一度だけレジ端末コードを入力すると、以降はログインなしでレジを使える。
 * コードが未設定のあいだは、ログインしてもらう案内だけを出す。
 */
export function RegisterUnlock({ codeConfigured }: { codeConfigured: boolean }) {
  const [state, action, pending] = useActionState(unlockRegister, { error: "" });
  const [code, setCode] = useState("");

  return (
    <div className="mx-auto max-w-md">
      <p className="mb-1 text-sm font-semibold tracking-tight text-ink-400">
        wear<span className="text-accent">POS</span>
      </p>
      <h1 className="text-xl font-semibold text-ink-900">レジ</h1>
      <p className="mt-1 text-sm text-ink-500">
        この端末はまだ認可されていません。お店の端末であることを一度だけ確認します
      </p>

      <div className="mt-4 rounded-xl border border-ink-200 bg-white p-5">
        {codeConfigured ? (
          <form action={action} className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs text-ink-500">レジ端末コード</span>
              <input
                name="code"
                type="password"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoComplete="off"
                inputMode="numeric"
                className="w-full rounded-lg border border-ink-200 px-3 py-2 text-base outline-none focus:border-ink-400"
              />
            </label>
            {state.error && <p className="text-sm text-rose-700">{state.error}</p>}
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink-800 disabled:opacity-40"
            >
              {pending ? "確認中..." : "この端末を認可する"}
            </button>
            <p className="text-xs text-ink-400">
              一度認可すれば、次からはそのままレジを開けます。
              コードが分からないときは店長・管理者にご確認ください
            </p>
          </form>
        ) : (
          <p className="text-sm text-ink-600">
            レジ端末コードがまだ設定されていません。
            <span className="font-medium">ログインするとレジを使えます。</span>
            <br />
            管理者は 設定 → レジ端末のアクセス からコードを決められます
          </p>
        )}

        <Link
          href="/login"
          className="mt-4 block rounded-lg border border-ink-200 bg-white px-4 py-2.5 text-center text-sm font-medium text-ink-600 hover:bg-ink-50"
        >
          ログインして使う
        </Link>
      </div>
    </div>
  );
}
