"use client";

import { useState, useTransition } from "react";

import {
  addProductField,
  deleteProductField,
  setProductFieldVisibility,
  updateProductField,
  type ProductFieldActionState,
} from "@/app/(app)/settings/product-field-actions";
import { Badge } from "@/components/ui";

export type ManagedProductField = {
  id: string;
  label: string;
  isBuiltin: boolean;
  isVisible: boolean;
  /** 選択肢を設定できるか (カスタム項目と、素材・原産国・取扱いの組み込み項目) */
  optionsEditable: boolean;
  /** 選択肢 (空なら自由入力) */
  options: string[];
  /** カスタム項目に入力済みの商品数 */
  valueCount: number;
};

const inputClass =
  "rounded-lg border border-ink-200 px-2.5 py-1.5 text-sm outline-none focus:border-ink-400";

/** 1項目の行。名称の編集と、カスタム項目は選択肢の追加・削除もできる */
function FieldRow({
  field,
  pending,
  onToggle,
  onDelete,
  onSave,
}: {
  field: ManagedProductField;
  pending: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onSave: (label: string, options: string[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(field.label);
  const [options, setOptions] = useState<string[]>(field.options);
  const [optionInput, setOptionInput] = useState("");

  const addOption = () => {
    const value = optionInput.trim();
    if (!value || options.includes(value)) return;
    setOptions((prev) => [...prev, value]);
    setOptionInput("");
  };

  if (!editing) {
    return (
      <li className="flex items-center justify-between gap-3 py-2">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className={`text-sm ${field.isVisible ? "text-ink-800" : "text-ink-400 line-through"}`}>
            {field.label}
          </span>
          <Badge tone={field.isBuiltin ? "neutral" : "info"}>
            {field.isBuiltin ? "組み込み" : "カスタム"}
          </Badge>
          {field.options.length > 0 && (
            <span className="truncate text-xs text-ink-400">
              選択肢: {field.options.join(" / ")}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-ink-500">
            <input
              type="checkbox"
              checked={field.isVisible}
              disabled={pending}
              onChange={onToggle}
              className="h-3.5 w-3.5 accent-ink-900"
            />
            表示
          </label>
          <button
            type="button"
            onClick={() => {
              setLabel(field.label);
              setOptions(field.options);
              setEditing(true);
            }}
            disabled={pending}
            className="rounded-lg border border-ink-200 px-2 py-1 text-xs text-ink-600 hover:bg-ink-50 disabled:opacity-40"
          >
            編集
          </button>
          {!field.isBuiltin && (
            <button
              type="button"
              onClick={onDelete}
              disabled={pending}
              className="rounded-lg border border-ink-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-40"
            >
              削除
            </button>
          )}
        </span>
      </li>
    );
  }

  return (
    <li className="space-y-2 rounded-lg bg-ink-50 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-ink-500">
          項目名
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            aria-label="項目名"
            className={`${inputClass} w-40`}
          />
        </label>
      </div>
      {field.optionsEditable && (
        <div>
          <p className="mb-1 text-xs text-ink-500">
            選択肢 (設定するとドロップダウンになります。空なら自由入力)
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {options.map((option) => (
              <span
                key={option}
                className="inline-flex items-center gap-1 rounded-full border border-ink-200 bg-white py-0.5 pr-1 pl-2.5 text-xs text-ink-700"
              >
                {option}
                <button
                  type="button"
                  onClick={() => setOptions((prev) => prev.filter((o) => o !== option))}
                  aria-label={`選択肢 ${option} を削除`}
                  className="flex h-4 w-4 items-center justify-center rounded-full text-ink-400 hover:bg-rose-100 hover:text-rose-700"
                >
                  ×
                </button>
              </span>
            ))}
            <input
              value={optionInput}
              onChange={(event) => setOptionInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addOption();
                }
              }}
              placeholder="選択肢を入力して Enter"
              className={`${inputClass} w-44`}
            />
            <button
              type="button"
              onClick={addOption}
              disabled={!optionInput.trim()}
              className="rounded-lg border border-ink-200 bg-white px-2 py-1 text-xs text-ink-600 hover:bg-ink-100 disabled:opacity-40"
            >
              追加
            </button>
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onSave(label, options)}
          disabled={pending || !label.trim()}
          className="rounded-lg bg-ink-900 px-3 py-1 text-xs font-medium text-white hover:bg-ink-800 disabled:opacity-40"
        >
          保存
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={pending}
          className="rounded-lg border border-ink-200 bg-white px-3 py-1 text-xs text-ink-600 hover:bg-ink-50"
        >
          キャンセル
        </button>
      </div>
    </li>
  );
}

/**
 * 商品の基本情報に表示する項目の設定。
 * 組み込み項目は表示のオンオフと名称変更、カスタム項目は追加・削除・名称変更・選択肢の管理ができる。
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

  const save = (field: ManagedProductField, nextLabel: string, options: string[]) => {
    startTransition(async () => {
      setState(await updateProductField({ id: field.id, label: nextLabel, options }));
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
          <FieldRow
            key={`${field.id}-${field.label}-${field.options.join(",")}`}
            field={field}
            pending={pending}
            onToggle={() => toggle(field)}
            onDelete={() => remove(field)}
            onSave={(nextLabel, options) => save(field, nextLabel, options)}
          />
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
            className={`${inputClass} w-52`}
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
