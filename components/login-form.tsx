"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { createInitialAdmin, login, signUp, type LoginState } from "@/app/(app)/login/actions";

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
  // 送信のたびにフォームがリセットされるため、選んだユーザーは自前で保持する
  const [username, setUsername] = useState("");
  return (
    <form action={formAction} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs text-ink-400">ユーザー</span>
        <select
          name="username"
          required
          autoFocus
          value={username}
          onChange={(event) => setUsername(event.target.value)}
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

/**
 * ログイン画面からの新規ユーザー作成。
 * 作成されるのはスタッフ権限 (レジ / 商品 / 在庫) のユーザーで、そのままログインする。
 */
export function SignUpForm({ needsCode }: { needsCode: boolean }) {
  const [state, formAction] = useActionState(signUp, INITIAL);
  // 入力エラーで送信し直すときに入力内容が消えないよう、値は自前で保持する
  const [form, setForm] = useState({
    username: "",
    displayName: "",
    password: "",
    passwordConfirm: "",
    signupCode: "",
  });
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <form action={formAction} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs text-ink-400">ユーザー名 (半角英数字・3文字以上)</span>
        <input
          name="username"
          autoComplete="username"
          autoFocus
          required
          pattern="[a-zA-Z0-9_.\-]{3,32}"
          placeholder="例: sato"
          value={form.username}
          onChange={set("username")}
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-ink-400">表示名</span>
        <input
          name="displayName"
          autoComplete="name"
          placeholder="例: 佐藤 花子"
          value={form.displayName}
          onChange={set("displayName")}
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-ink-400">パスワード (8文字以上)</span>
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={form.password}
          onChange={set("password")}
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-ink-400">パスワード (確認)</span>
        <input
          type="password"
          name="passwordConfirm"
          autoComplete="new-password"
          required
          minLength={8}
          value={form.passwordConfirm}
          onChange={set("passwordConfirm")}
          className={inputClass}
        />
      </label>
      {needsCode && (
        <label className="block">
          <span className="mb-1 block text-xs text-ink-400">合言葉 (店舗から共有されたもの)</span>
          <input
            type="password"
            name="signupCode"
            autoComplete="off"
            required
            value={form.signupCode}
            onChange={set("signupCode")}
            className={inputClass}
          />
        </label>
      )}
      {state.error && <p className="text-sm text-rose-700">{state.error}</p>}
      <SubmitButton label="作成してログイン" />
      <p className="text-xs text-ink-400">
        作成されるのは<span className="font-medium text-ink-600">スタッフ権限</span>
        （レジ・商品・在庫）のユーザーです。 顧客情報や設定を使うには、管理者に権限の変更を依頼してください。
      </p>
    </form>
  );
}

/** ログインと新規作成をタブで切り替える */
export function LoginPanel({
  users,
  canSignUp,
  needsCode,
}: {
  users: LoginUserOption[];
  canSignUp: boolean;
  needsCode: boolean;
}) {
  const [tab, setTab] = useState<"login" | "signup">("login");

  if (!canSignUp) return <LoginForm users={users} />;

  const tabClass = (active: boolean) =>
    `flex-1 rounded-lg px-2 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors sm:text-sm ${
      active ? "bg-white text-ink-900 shadow-[0_1px_2px_rgba(22,22,28,0.08)]" : "text-ink-400 hover:text-ink-600"
    }`;

  return (
    <div>
      <div className="mb-4 flex gap-1 rounded-lg bg-ink-100 p-1">
        <button type="button" onClick={() => setTab("login")} className={tabClass(tab === "login")}>
          ログイン
        </button>
        <button
          type="button"
          onClick={() => setTab("signup")}
          className={tabClass(tab === "signup")}
        >
          新規ユーザーを作成
        </button>
      </div>
      {tab === "login" ? <LoginForm users={users} /> : <SignUpForm needsCode={needsCode} />}
    </div>
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
