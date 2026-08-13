"use client";

import { useState, useTransition } from "react";

import {
  addSeason,
  deleteSeason,
  type MasterActionState,
} from "@/app/(app)/settings/master-actions";
import {
  addProductField,
  deleteProductField,
  moveProductField,
  setProductFieldVisibility,
  updateProductField,
  type ProductFieldActionState,
} from "@/app/(app)/settings/product-field-actions";
import { MasterChipManager, type ManagedMasterItem } from "@/components/master-managers";
import { Badge } from "@/components/ui";

export type ManagedProductField = {
  id: string;
  /** 組み込み項目のキー (brand/category/season/material/originCountry/careNote)。カスタムは null */
  builtinKey: string | null;
  label: string;
  isVisible: boolean;
  /** 自由入力の選択肢 (素材・原産国・取扱い・カスタム項目用) */
  options: string[];
  /** カスタム項目に入力済みの商品数 */
  valueCount: number;
};

export type ManagedSeason = {
  id: string;
  code: string;
  name: string;
  productCount: number;
};

const inputClass =
  "rounded-lg border border-ink-200 px-2.5 py-1.5 text-sm outline-none focus:border-ink-400";

type Feedback = ProductFieldActionState | MasterActionState;

/** シーズンの選択肢管理 (年+区分で追加、未使用のみ削除可) */
function SeasonOptions({
  seasons,
  pending,
  startTransition,
  setFeedback,
}: {
  seasons: ManagedSeason[];
  pending: boolean;
  startTransition: (fn: () => Promise<void>) => void;
  setFeedback: (state: Feedback) => void;
}) {
  const [year, setYear] = useState(String(new Date().getFullYear() + 1));
  const [term, setTerm] = useState<"SS" | "AW" | "ALL">("SS");

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {seasons.map((season) => (
          <span
            key={season.id}
            className="inline-flex items-center gap-1 rounded-full border border-ink-200 bg-ink-50 py-0.5 pr-1 pl-2.5 text-xs text-ink-700"
          >
            {season.code}
            <span className="text-[10px] text-ink-400">{season.productCount}</span>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm(`シーズン「${season.code}」を削除しますか？`)) return;
                startTransition(async () => setFeedback(await deleteSeason(season.id)));
              }}
              disabled={pending || season.productCount > 0}
              title={
                season.productCount > 0
                  ? "商品で使われているため削除できません"
                  : `${season.code} を削除`
              }
              aria-label={`シーズン ${season.code} を削除`}
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
          startTransition(async () =>
            setFeedback(await addSeason({ year: Number(year), term })),
          );
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-400">年 (西暦)</span>
          <input
            type="number"
            min={2000}
            max={2100}
            value={year}
            onChange={(event) => setYear(event.target.value)}
            className={`${inputClass} tabular w-24 text-right`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-400">区分</span>
          <select
            value={term}
            onChange={(event) => setTerm(event.target.value as "SS" | "AW" | "ALL")}
            className={inputClass}
          >
            <option value="SS">SS (春夏)</option>
            <option value="AW">AW (秋冬)</option>
            <option value="ALL">ALL (通年定番)</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={pending || !year}
          className="rounded-lg bg-ink-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-40"
        >
          追加
        </button>
      </form>
      <p className="mt-1.5 text-xs text-ink-400">
        コードと期間は自動で設定されます (例: 2027SS = 2/1〜7/31)
      </p>
    </div>
  );
}

/** 自由入力項目の選択肢エディタ (チップで追加・削除し、保存で反映) */
function FreeOptionsEditor({
  options,
  setOptions,
}: {
  options: string[];
  setOptions: (next: string[]) => void;
}) {
  const [input, setInput] = useState("");

  const add = () => {
    const value = input.trim();
    if (!value || options.includes(value)) return;
    setOptions([...options, value]);
    setInput("");
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.map((option) => (
        <span
          key={option}
          className="inline-flex items-center gap-1 rounded-full border border-ink-200 bg-ink-50 py-0.5 pr-1 pl-2.5 text-xs text-ink-700"
        >
          {option}
          <button
            type="button"
            onClick={() => setOptions(options.filter((o) => o !== option))}
            aria-label={`選択肢 ${option} を削除`}
            className="flex h-4 w-4 items-center justify-center rounded-full text-ink-400 hover:bg-rose-100 hover:text-rose-700"
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add();
          }
        }}
        placeholder="選択肢を入力して Enter"
        className={`${inputClass} w-44`}
      />
      <button
        type="button"
        onClick={add}
        disabled={!input.trim()}
        className="rounded-lg border border-ink-200 bg-white px-2 py-1 text-xs text-ink-600 hover:bg-ink-50 disabled:opacity-40"
      >
        追加
      </button>
    </div>
  );
}

/** 選択中の項目の編集パネル。名称・表示・選択肢・削除をここで完結する */
function FieldEditor({
  field,
  brands,
  categories,
  seasons,
  pending,
  startTransition,
  setFeedback,
}: {
  field: ManagedProductField;
  brands: ManagedMasterItem[];
  categories: ManagedMasterItem[];
  seasons: ManagedSeason[];
  pending: boolean;
  startTransition: (fn: () => Promise<void>) => void;
  setFeedback: (state: Feedback) => void;
}) {
  const [label, setLabel] = useState(field.label);
  const [options, setOptions] = useState<string[]>(field.options);
  const usesFreeOptions =
    !field.builtinKey || ["material", "originCountry", "careNote"].includes(field.builtinKey);
  const dirty =
    label !== field.label ||
    (usesFreeOptions && JSON.stringify(options) !== JSON.stringify(field.options));

  const save = () => {
    startTransition(async () =>
      setFeedback(await updateProductField({ id: field.id, label, options })),
    );
  };

  return (
    <div className="rounded-lg border border-ink-100 bg-ink-50/50 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-400">項目名</span>
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            aria-label="項目名"
            className={`${inputClass} w-48 bg-white`}
          />
        </label>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-ink-600">
            <input
              type="checkbox"
              checked={field.isVisible}
              disabled={pending}
              onChange={() =>
                startTransition(async () =>
                  setFeedback(await setProductFieldVisibility(field.id, !field.isVisible)),
                )
              }
              className="h-4 w-4 accent-ink-900"
            />
            商品画面に表示する
          </label>
          {!field.builtinKey && (
            <button
              type="button"
              onClick={() => {
                const warn =
                  field.valueCount > 0
                    ? `項目「${field.label}」を削除しますか？${field.valueCount} 件の商品に入力された値も削除されます。`
                    : `項目「${field.label}」を削除しますか？`;
                if (!window.confirm(warn)) return;
                startTransition(async () => setFeedback(await deleteProductField(field.id)));
              }}
              disabled={pending}
              className="rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-40"
            >
              項目を削除
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 border-t border-ink-100 pt-3">
        <p className="mb-2 text-xs font-medium text-ink-400">
          選択肢
          {field.builtinKey === "brand" || field.builtinKey === "category"
            ? " (商品登録で選べるマスタ。数字は使用商品数)"
            : field.builtinKey === "season"
              ? " (数字は使用商品数)"
              : " (設定するとドロップダウン、空なら自由入力)"}
        </p>
        {field.builtinKey === "brand" && <MasterChipManager kind="brand" items={brands} />}
        {field.builtinKey === "category" && (
          <MasterChipManager kind="category" items={categories} />
        )}
        {field.builtinKey === "season" && (
          <SeasonOptions
            seasons={seasons}
            pending={pending}
            startTransition={startTransition}
            setFeedback={setFeedback}
          />
        )}
        {usesFreeOptions && <FreeOptionsEditor options={options} setOptions={setOptions} />}
      </div>

      {dirty && (
        <div className="mt-3 flex gap-2 border-t border-ink-100 pt-3">
          <button
            type="button"
            onClick={save}
            disabled={pending || !label.trim()}
            aria-label="項目設定を保存"
            className="rounded-lg bg-ink-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-40"
          >
            保存
          </button>
          <button
            type="button"
            onClick={() => {
              setLabel(field.label);
              setOptions(field.options);
            }}
            disabled={pending}
            className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50"
          >
            元に戻す
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 商品の基本情報に表示する項目の設定。
 * 左の一覧から項目を選ぶと、名称・表示/非表示・選択肢 (ブランド/カテゴリ/シーズンの
 * マスタ管理を含む)・削除を右のパネルでまとめて編集できる。
 */
export function ProductFieldSettings({
  fields,
  brands,
  categories,
  seasons,
}: {
  fields: ManagedProductField[];
  brands: ManagedMasterItem[];
  categories: ManagedMasterItem[];
  seasons: ManagedSeason[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(fields[0]?.id ?? null);
  const [newLabel, setNewLabel] = useState("");
  const [feedback, setFeedback] = useState<Feedback>({ status: "idle", message: "" });
  const [pending, startTransition] = useTransition();

  const selected = fields.find((field) => field.id === selectedId) ?? fields[0] ?? null;

  return (
    <div>
      <div className="grid gap-4 lg:grid-cols-[230px_1fr]">
        {/* 項目一覧 (選択 + ↑↓ で表示順の変更) */}
        <ul className="flex flex-row flex-wrap gap-1.5 lg:flex-col lg:gap-1">
          {fields.map((field, index) => (
            <li key={field.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setSelectedId(field.id)}
                className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-left text-sm transition-colors ${
                  selected?.id === field.id
                    ? "border-ink-900 bg-ink-900 text-white"
                    : "border-ink-200 bg-white text-ink-600 hover:bg-ink-50"
                }`}
              >
                <span className={`truncate ${field.isVisible ? "" : "line-through opacity-60"}`}>
                  {field.label}
                </span>
                {!field.builtinKey && (
                  <Badge tone={selected?.id === field.id ? "neutral" : "info"}>カスタム</Badge>
                )}
              </button>
              <span className="flex shrink-0 flex-col">
                <button
                  type="button"
                  onClick={() =>
                    startTransition(async () => setFeedback(await moveProductField(field.id, "up")))
                  }
                  disabled={pending || index === 0}
                  aria-label={`${field.label} を上へ`}
                  className="h-4 w-5 text-[10px] leading-none text-ink-400 hover:text-ink-900 disabled:opacity-20"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() =>
                    startTransition(async () =>
                      setFeedback(await moveProductField(field.id, "down")),
                    )
                  }
                  disabled={pending || index === fields.length - 1}
                  aria-label={`${field.label} を下へ`}
                  className="h-4 w-5 text-[10px] leading-none text-ink-400 hover:text-ink-900 disabled:opacity-20"
                >
                  ▼
                </button>
              </span>
            </li>
          ))}
        </ul>

        {/* 編集パネル (選択項目の名称・表示・選択肢・削除) */}
        {selected ? (
          <FieldEditor
            key={`${selected.id}-${selected.label}-${selected.isVisible}-${selected.options.join(",")}`}
            field={selected}
            brands={brands}
            categories={categories}
            seasons={seasons}
            pending={pending}
            startTransition={startTransition}
            setFeedback={setFeedback}
          />
        ) : (
          <p className="text-sm text-ink-400">項目がありません</p>
        )}
      </div>

      <p className="mt-2 text-xs text-ink-400">
        カラー・サイズは SKU の構成要素のため常に表示されます。非表示の項目は取り消し線で表示しています。
      </p>

      {/* カスタム項目の追加 */}
      <form
        className="mt-3 flex flex-wrap items-end gap-2 border-t border-ink-100 pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            const result = await addProductField({ label: newLabel });
            setFeedback(result);
            if (result.status === "success") setNewLabel("");
          });
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-400">項目を追加 (任意の名前)</span>
          <input
            value={newLabel}
            onChange={(event) => setNewLabel(event.target.value)}
            placeholder="例: フィット / 柄 / 洗濯表示"
            className={`${inputClass} w-52`}
          />
        </label>
        <button
          type="submit"
          disabled={pending || !newLabel.trim()}
          className="rounded-lg bg-ink-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-40"
        >
          追加
        </button>
      </form>

      {feedback.status !== "idle" && (
        <p
          className={`mt-2 text-xs ${
            feedback.status === "success" ? "text-emerald-700" : "text-rose-700"
          }`}
        >
          {feedback.message}
        </p>
      )}
    </div>
  );
}
