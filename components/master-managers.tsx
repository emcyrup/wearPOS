"use client";

import { useState, useTransition } from "react";

import {
  addCategory,
  addStaff,
  deleteCategory,
  deleteStaff,
  restoreStaff,
  type MasterActionState,
} from "@/app/settings/master-actions";
import { Badge } from "@/components/ui";

const inputClass =
  "rounded-lg border border-ink-200 px-2.5 py-1.5 text-sm outline-none focus:border-ink-400";

function StatusText({ state }: { state: MasterActionState }) {
  if (state.status === "idle") return null;
  return (
    <p
      className={`mt-2 text-xs ${state.status === "success" ? "text-emerald-700" : "text-rose-700"}`}
    >
      {state.message}
    </p>
  );
}

// ---------------------------------------------------------------------------
// カテゴリ (追加 / 削除)
// ---------------------------------------------------------------------------

export type ManagedCategory = { id: string; code: string; name: string; productCount: number };

export function CategoryManager({ categories }: { categories: ManagedCategory[] }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [state, setState] = useState<MasterActionState>({ status: "idle", message: "" });
  const [pending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      const result = await addCategory({ code, name });
      setState(result);
      if (result.status === "success") {
        setCode("");
        setName("");
      }
    });
  };

  const remove = (category: ManagedCategory) => {
    if (!window.confirm(`カテゴリ「${category.name}」を削除しますか？`)) return;
    startTransition(async () => {
      setState(await deleteCategory(category.id));
    });
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {categories.map((category) => (
          <span
            key={category.id}
            className="inline-flex items-center gap-1 rounded-full border border-ink-200 bg-ink-50 py-0.5 pr-1 pl-2.5 text-xs text-ink-700"
          >
            {category.name}
            <span className="text-[10px] text-ink-400">{category.productCount}</span>
            <button
              type="button"
              onClick={() => remove(category)}
              disabled={pending || category.productCount > 0}
              title={
                category.productCount > 0
                  ? "商品で使われているため削除できません"
                  : `${category.name} を削除`
              }
              aria-label={`カテゴリ ${category.name} を削除`}
              className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-ink-400 hover:bg-rose-100 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-30"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <form
        className="mt-3 flex flex-wrap items-end gap-2 border-t border-ink-100 pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-400">コード</span>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="OUTER"
            className={`${inputClass} w-24 uppercase`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-400">カテゴリ名</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="アウター"
            className={`${inputClass} w-36`}
          />
        </label>
        <button
          type="submit"
          disabled={pending || !code.trim() || !name.trim()}
          className="rounded-lg bg-ink-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-40"
        >
          追加
        </button>
      </form>
      <StatusText state={state} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 担当スタッフ (追加 / 削除)
// ---------------------------------------------------------------------------

export type ManagedStaff = {
  id: string;
  code: string;
  name: string;
  role: string;
  storeName: string | null;
  isActive: boolean;
  /** 取引・在庫移動の履歴があるか (削除ではなく無効化になる) */
  hasHistory: boolean;
};

export function StaffManager({
  staff,
  stores,
}: {
  staff: ManagedStaff[];
  stores: { id: string; name: string }[];
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [storeId, setStoreId] = useState("");
  const [role, setRole] = useState<"STAFF" | "MANAGER">("STAFF");
  const [state, setState] = useState<MasterActionState>({ status: "idle", message: "" });
  const [pending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      const result = await addStaff({ code, name, storeId, role });
      setState(result);
      if (result.status === "success") {
        setCode("");
        setName("");
      }
    });
  };

  const remove = (person: ManagedStaff) => {
    const message = person.hasHistory
      ? `「${person.name}」には取引履歴があるため、削除の代わりに無効化されます。よろしいですか？`
      : `スタッフ「${person.name}」を削除しますか？`;
    if (!window.confirm(message)) return;
    startTransition(async () => {
      setState(await deleteStaff(person.id));
    });
  };

  const restore = (person: ManagedStaff) => {
    startTransition(async () => {
      setState(await restoreStaff(person.id));
    });
  };

  return (
    <div>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs text-ink-400">
            <th className="px-2 py-1.5 font-medium">コード</th>
            <th className="px-2 py-1.5 font-medium">氏名</th>
            <th className="px-2 py-1.5 font-medium">所属</th>
            <th className="px-2 py-1.5 font-medium">権限</th>
            <th className="px-2 py-1.5" />
          </tr>
        </thead>
        <tbody>
          {staff.map((person) => (
            <tr key={person.id} className="border-b border-ink-100 last:border-0">
              <td className="tabular px-2 py-2 text-xs text-ink-400">{person.code}</td>
              <td className="px-2 py-2 font-medium text-ink-800">
                {person.name}
                {!person.isActive && (
                  <span className="ml-1.5 inline-flex">
                    <Badge tone="neutral">無効</Badge>
                  </span>
                )}
              </td>
              <td className="px-2 py-2 text-ink-600">{person.storeName ?? "—"}</td>
              <td className="px-2 py-2">
                <Badge tone={person.role === "MANAGER" ? "info" : "neutral"}>{person.role}</Badge>
              </td>
              <td className="px-2 py-2 text-right whitespace-nowrap">
                {person.isActive ? (
                  <button
                    type="button"
                    onClick={() => remove(person)}
                    disabled={pending}
                    className="rounded-lg border border-ink-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                  >
                    {person.hasHistory ? "無効化" : "削除"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => restore(person)}
                    disabled={pending}
                    className="rounded-lg border border-ink-200 px-2 py-1 text-xs text-ink-600 hover:bg-ink-50 disabled:opacity-40"
                  >
                    再有効化
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        className="mt-3 flex flex-wrap items-end gap-2 border-t border-ink-100 pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-400">コード</span>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="S010"
            className={`${inputClass} w-20 uppercase`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-400">氏名</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="山田 花子"
            className={`${inputClass} w-32`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-400">所属</span>
          <select value={storeId} onChange={(event) => setStoreId(event.target.value)} className={inputClass}>
            <option value="">全店舗</option>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-400">権限</span>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as "STAFF" | "MANAGER")}
            className={inputClass}
          >
            <option value="STAFF">STAFF</option>
            <option value="MANAGER">MANAGER</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={pending || !code.trim() || !name.trim()}
          className="rounded-lg bg-ink-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-40"
        >
          追加
        </button>
      </form>
      <StatusText state={state} />
    </div>
  );
}
