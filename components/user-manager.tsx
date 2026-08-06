"use client";

import { useState, useTransition } from "react";

import { createUser, updateUser, type UserActionState } from "@/app/settings/user-actions";

type FeatureOption = { key: string; label: string };

export type ManagedUser = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  features: string[];
  isActive: boolean;
};

const inputClass =
  "rounded-lg border border-ink-200 px-2.5 py-1.5 text-sm outline-none focus:border-ink-400";

function FeatureChecks({
  features,
  value,
  onChange,
  disabled,
}: {
  features: FeatureOption[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5">
      {features.map((feature) => (
        <label
          key={feature.key}
          className={`flex items-center gap-1 text-xs ${disabled ? "text-ink-300" : "text-ink-600"}`}
        >
          <input
            type="checkbox"
            disabled={disabled}
            checked={value.includes(feature.key)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...value, feature.key]
                  : value.filter((key) => key !== feature.key),
              )
            }
            className="h-3.5 w-3.5 accent-ink-900"
          />
          {feature.label}
        </label>
      ))}
    </div>
  );
}

function UserRow({
  user,
  features,
  isSelf,
}: {
  user: ManagedUser;
  features: FeatureOption[];
  isSelf: boolean;
}) {
  const [role, setRole] = useState(user.role);
  const [allowed, setAllowed] = useState(user.features);
  const [isActive, setIsActive] = useState(user.isActive);
  const [newPassword, setNewPassword] = useState("");
  const [result, setResult] = useState<UserActionState | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty =
    role !== user.role ||
    isActive !== user.isActive ||
    newPassword !== "" ||
    JSON.stringify([...allowed].sort()) !== JSON.stringify([...user.features].sort());

  const save = () =>
    startTransition(async () => {
      setResult(
        await updateUser({ id: user.id, role, features: allowed, isActive, newPassword }),
      );
      setNewPassword("");
    });

  return (
    <li className={`px-4 py-3 ${isActive ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-32">
          <p className="text-sm font-medium text-ink-800">
            {user.displayName}
            {isSelf && <span className="ml-1.5 text-xs font-normal text-ink-400">(自分)</span>}
          </p>
          <p className="tabular text-xs text-ink-400">{user.username}</p>
        </div>
        <select
          value={role}
          onChange={(event) => setRole(event.target.value)}
          disabled={isSelf}
          className={inputClass}
        >
          <option value="ADMIN">管理者</option>
          <option value="STAFF">スタッフ</option>
        </select>
        <label className={`flex items-center gap-1 text-xs ${isSelf ? "text-ink-300" : "text-ink-600"}`}>
          <input
            type="checkbox"
            checked={isActive}
            disabled={isSelf}
            onChange={(event) => setIsActive(event.target.checked)}
            className="h-3.5 w-3.5 accent-ink-900"
          />
          有効
        </label>
        <input
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          placeholder="新しいパスワード (変更時のみ)"
          autoComplete="new-password"
          className={`${inputClass} w-52`}
        />
        <button
          type="button"
          onClick={save}
          disabled={!dirty || pending}
          className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-800 disabled:opacity-40"
        >
          {pending ? "保存中..." : "保存"}
        </button>
        {result && (
          <span
            className={`text-xs ${result.status === "error" ? "text-rose-700" : "text-emerald-700"}`}
          >
            {result.message}
          </span>
        )}
      </div>
      <div className="mt-2">
        {role === "ADMIN" ? (
          <p className="text-xs text-ink-400">管理者はすべての機能を使えます</p>
        ) : (
          <FeatureChecks features={features} value={allowed} onChange={setAllowed} disabled={false} />
        )}
      </div>
    </li>
  );
}

/**
 * ユーザーと権限の管理 (管理者のみ)。
 * スタッフには機能キー単位でアクセスを許可する。
 */
export function UserManager({
  users,
  features,
  currentUserId,
  defaultStaffFeatures,
}: {
  users: ManagedUser[];
  features: FeatureOption[];
  currentUserId: string;
  defaultStaffFeatures: string[];
}) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("STAFF");
  const [allowed, setAllowed] = useState<string[]>(defaultStaffFeatures);
  const [result, setResult] = useState<UserActionState | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      const state = await createUser({ username, displayName, password, role, features: allowed });
      setResult(state);
      if (state.status === "success") {
        setUsername("");
        setDisplayName("");
        setPassword("");
        setRole("STAFF");
        setAllowed(defaultStaffFeatures);
      }
    });

  return (
    <div>
      <ul className="divide-y divide-ink-100 rounded-lg border border-ink-100">
        {users.map((user) => (
          <UserRow key={user.id} user={user} features={features} isSelf={user.id === currentUserId} />
        ))}
      </ul>

      <form
        className="mt-4 rounded-lg border border-dashed border-ink-200 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <p className="mb-3 text-xs font-medium text-ink-400">ユーザーを追加</p>
        <div className="flex flex-wrap gap-2">
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="ユーザー名 (半角英数字)"
            required
            className={`${inputClass} w-44`}
          />
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="表示名"
            required
            className={`${inputClass} w-40`}
          />
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="パスワード (8文字以上)"
            required
            minLength={8}
            autoComplete="new-password"
            className={`${inputClass} w-48`}
          />
          <select value={role} onChange={(event) => setRole(event.target.value)} className={inputClass}>
            <option value="STAFF">スタッフ</option>
            <option value="ADMIN">管理者</option>
          </select>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-ink-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-50"
          >
            {pending ? "追加中..." : "追加"}
          </button>
        </div>
        {role === "STAFF" && (
          <div className="mt-3">
            <p className="mb-1.5 text-xs text-ink-400">使える機能</p>
            <FeatureChecks features={features} value={allowed} onChange={setAllowed} disabled={false} />
          </div>
        )}
        {result && (
          <p
            className={`mt-2 text-xs ${
              result.status === "error" ? "text-rose-700" : "text-emerald-700"
            }`}
          >
            {result.message}
          </p>
        )}
      </form>
    </div>
  );
}
