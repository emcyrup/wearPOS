"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { createInitialAdmin, login, type LoginState } from "@/app/(app)/login/actions";

const INITIAL: LoginState = { error: "" };

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white hover:bg-ink-800 disabled:opacity-50"
    >
      {pending ? "確認中..." : label}
    </button>
  );
}

const inputClass =
  "w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-400";

export type LoginUserOption = {
  username: string;
  displayName: string;
  role: string;
};

export function LoginForm({ users }: { users: LoginUserOption[] }) {
  const [state, formAction] = useActionState(login, INITIAL);
  return (
    <form action={formAction} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs text-ink-400">ユーザー</span>
        <select
          name="username"
          required
          autoFocus
          defaultValue=""
          className={`${inputClass} bg-white`}
        >
          <option value="" disabled>
            ユーザーを選択してください
          </option>
          {users.map((user) => (
            <option key={user.username} value={user.username}>
              {user.displayName}
              {user.role === "ADMIN" ? " (管理者)" : ""} — {user.username}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-ink-400">パスワード</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          className={inputClass}
        />
      </label>
      {state.error && <p className="text-sm text-rose-700">{state.error}</p>}
      <SubmitButton label="ログイン" />
    </form>
  );
}

/** ユーザーが1人もいないときの管理者作成フォーム */
export function SetupForm() {
  const [state, formAction] = useActionState(createInitialAdmin, INITIAL);
  return (
    <form action={formAction} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs text-ink-400">ユーザー名 (半角英数字)</span>
        <input name="username" autoComplete="username" autoFocus required className={inputClass} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-ink-400">表示名</span>
        <input name="displayName" placeholder="例: 店長 佐藤" className={inputClass} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-ink-400">パスワード (8文字以上)</span>
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
          className={inputClass}
        />
      </label>
      {state.error && <p className="text-sm text-rose-700">{state.error}</p>}
      <SubmitButton label="管理者を作成して開始" />
    </form>
  );
}
