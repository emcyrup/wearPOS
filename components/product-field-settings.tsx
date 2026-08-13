"use client";

import { useState, useTransition } from "react";

import {
  addProductField,
  deleteProductField,
  setProductFieldVisibility,
  type ProductFieldActionState,
} from "@/app/(app)/settings/product-field-actions";
import { Badge } from "@/components/ui";

export type ManagedProductField = {
  id: string;
  label: string;
  isBuiltin: boolean;
  isVisible: boolean;
  /** カスタム項目に入力済みの商品数 */
  valueCount: number;
};

/**
 * 商品の基本情報に表示する項目の設定。
 * 組み込み項目 (ブランド・カテゴリなど) は表示のオンオフ、
 * カスタム項目はユーザーが任意に追加・削除できる。
 */
export function ProductFieldSettings({ fields }: { fields: ManagedProductField[] }) {
  const [label, setLabel] = useState("");
  const [state, setState] = useState<ProductFieldActionState>({ status: "idle", message: "" });
  const [pending, startTransition] = useTransition();

  const toggle = (field: ManagedProductField) => {
    startTransition(async () => {
      setState(await setProductFieldVisibility(field.id, !field.isVisible));
    });
  };

  const remove = (field: ManagedProductField) => {
    const warn =
      field.valueCount > 0
        ? `項目「${field.label}」を削除しますか？${field.valueCount} 件の商品に入力された値も削除されます。`
        : `項目「${field.label}」を削除しますか？`;
    if (!window.confirm(warn)) return;
    startTransition(async () => {
      setState(await deleteProductField(field.id));
    });
  };

  const submit = () => {
    startTransition(async () => {
      const result = await addProductField({ label });
      setState(result);
      if (result.status === "success") setLabel("");
    });
  };

  return (
    <div>
      <ul className="divide-y divide-ink-100">
        {fields.map((field) => (
          <li key={field.id} className="flex items-center justify-between gap-3 py-2">
            <span className="flex items-center gap-2">
              <span className={`text-sm ${field.isVisible ? "text-ink-800" : "text-ink-400 line-through"}`}>
                {field.label}
              </span>
              <Badge tone={field.isBuiltin ? "neutral" : "info"}>
                {field.isBuiltin ? "組み込み" : "カスタム"}
              </Badge>
            </span>
            <span className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-ink-500">
                <input
                  type="checkbox"
                  checked={field.isVisible}
                  disabled={pending}
                  onChange={() => toggle(field)}
                  className="h-3.5 w-3.5 accent-ink-900"
                />
                表示
              </label>
              {!field.isBuiltin && (
                <button
                  type="button"
                  onClick={() => remove(field)}
                  disabled={pending}
                  className="rounded-lg border border-ink-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                >
                  削除
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-ink-400">
        カラー・サイズは SKU の構成要素のため常に表示されます。
      </p>
      <form
        className="mt-3 flex flex-wrap items-end gap-2 border-t border-ink-100 pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-400">項目を追加 (任意の名前)</span>
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="例: フィット / 柄 / 洗濯表示"
            className="w-52 rounded-lg border border-ink-200 px-2.5 py-1.5 text-sm outline-none focus:border-ink-400"
          />
        </label>
        <button
          type="submit"
          disabled={pending || !label.trim()}
          className="rounded-lg bg-ink-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-40"
        >
          追加
        </button>
      </form>
      {state.status !== "idle" && (
        <p
          className={`mt-2 text-xs ${
            state.status === "success" ? "text-emerald-700" : "text-rose-700"
          }`}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
