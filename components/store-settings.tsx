"use client";

import { useState, useTransition } from "react";

import { updateStore, type StoreState } from "@/app/(app)/settings/store-actions";

export type EditableStore = {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  address: string | null;
  salesCount: number;
};

const inputClass =
  "w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-400";

/**
 * 店舗情報の編集。
 * 店舗名はレシートの先頭に印字されるため、開店前に自店の名前へ変えてもらう。
 */
export function StoreSettings({ store, canEdit }: { store: EditableStore; canEdit: boolean }) {
  const [name, setName] = useState(store.name);
  const [phone, setPhone] = useState(store.phone ?? "");
  const [address, setAddress] = useState(store.address ?? "");
  const [state, setState] = useState<StoreState>({ status: "idle", message: "" });
  const [pending, startTransition] = useTransition();

  const dirty =
    name !== store.name || phone !== (store.phone ?? "") || address !== (store.address ?? "");

  const save = () =>
    startTransition(async () => {
      setState(await updateStore({ id: store.id, name, phone, address }));
    });

  if (!canEdit) {
    return (
      <div className="text-sm text-ink-600">
        <p className="font-medium text-ink-800">{store.name}</p>
        <p className="tabular mt-1 text-xs text-ink-400">
          {store.code} · 取引 {store.salesCount.toLocaleString("ja-JP")} 件
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs text-ink-500">
            店舗名 <span className="text-rose-600">*</span>（レシートに印字されます）
          </span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="店舗名"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-ink-500">電話番号</span>
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="03-1234-5678"
            aria-label="店舗の電話番号"
            className={inputClass}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs text-ink-500">住所</span>
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            aria-label="店舗の住所"
            className={inputClass}
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          aria-label="店舗情報を保存する"
          disabled={pending || !dirty || name.trim() === ""}
          className="rounded-lg bg-ink-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-40"
        >
          {pending ? "保存中..." : "保存する"}
        </button>
        {state.status !== "idle" && (
          <p
            className={`text-xs ${state.status === "success" ? "text-emerald-700" : "text-rose-700"}`}
          >
            {state.message}
          </p>
        )}
      </div>

      <p className="tabular mt-3 text-xs text-ink-400">
        店舗コード {store.code} · 取引 {store.salesCount.toLocaleString("ja-JP")} 件
      </p>
    </div>
  );
}
