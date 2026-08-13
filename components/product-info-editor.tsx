"use client";

import { useState, useTransition } from "react";

import { updateProductInfo } from "@/app/(app)/products/[id]/actions";
import { Card } from "@/components/ui";

type Option = { id: string; name: string; code?: string };

export type EditorField = {
  id: string;
  builtinKey: string | null;
  label: string;
  options: string[];
};

export type EditableProduct = {
  id: string;
  styleCode: string;
  name: string;
  brandId: string;
  categoryId: string;
  seasonId: string;
  material: string;
  originCountry: string;
  careNote: string;
  costPrice: number;
  currentPrice: number;
  listPrice: number;
  taxRate: number;
  createdAt: string;
  /** カスタム項目の入力値 (fieldId → value) */
  customValues: Record<string, string>;
};

const inputClass =
  "w-full rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-ink-400";

const yen = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

/** 選択肢があるならドロップダウン、なければ自由入力 */
function TextOrSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (next: string) => void;
  options: string[];
}) {
  if (options.length > 0) {
    return (
      <select value={value} onChange={(event) => onChange(event.target.value)} className={inputClass}>
        <option value="">未選択</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input value={value} onChange={(event) => onChange(event.target.value)} className={inputClass} />
  );
}

/**
 * 商品詳細の「商品情報」。表示と編集を切り替えられる。
 * 項目は設定 (商品の基本情報 項目) の表示・並び順に従う。
 * 販売価格を変更すると価格改定履歴に自動で残る。
 */
export function ProductInfoEditor({
  product,
  brands,
  categories,
  seasons,
  fields,
  canEdit,
  className,
}: {
  product: EditableProduct;
  brands: Option[];
  categories: Option[];
  seasons: Option[];
  fields: EditorField[];
  canEdit: boolean;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [form, setForm] = useState(() => ({
    name: product.name,
    brandId: product.brandId,
    categoryId: product.categoryId,
    seasonId: product.seasonId,
    material: product.material,
    originCountry: product.originCountry,
    careNote: product.careNote,
    costPrice: String(product.costPrice),
    currentPrice: String(product.currentPrice),
    taxRate: String(Math.round(product.taxRate * 100)),
    customValues: { ...product.customValues },
  }));

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await updateProductInfo({
        productId: product.id,
        name: form.name,
        brandId: form.brandId,
        categoryId: form.categoryId,
        seasonId: form.seasonId,
        material: form.material,
        originCountry: form.originCountry,
        careNote: form.careNote,
        costPrice: Number(form.costPrice) || 0,
        currentPrice: Number(form.currentPrice) || 0,
        taxRate: (Number(form.taxRate) || 10) / 100,
        customFields: fields
          .filter((field) => field.builtinKey === null)
          .map((field) => ({
            fieldId: field.id,
            value: (form.customValues[field.id] ?? "").trim(),
          })),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
    });
  };

  const nameOf = (list: Option[], id: string) => list.find((item) => item.id === id)?.name ?? "—";
  const seasonLabelOf = (id: string) => {
    const season = seasons.find((item) => item.id === id);
    return season ? (season.code ? `${season.code} (${season.name})` : season.name) : "—";
  };

  // カード右上のアクション: 表示中は「編集する」、編集中はキャンセル
  const headerAction = !canEdit ? undefined : editing ? (
    <button
      type="button"
      onClick={() => setEditing(false)}
      disabled={pending}
      className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm whitespace-nowrap text-ink-600 hover:bg-ink-50 disabled:opacity-50"
    >
      キャンセル
    </button>
  ) : (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm font-medium whitespace-nowrap text-ink-600 hover:bg-ink-50"
    >
      ✏️ 編集する
    </button>
  );

  // ---- 表示モード ----
  if (!editing) {
    const rows: [string, string][] = [
      ["品番", product.styleCode],
      ["商品名", product.name],
      ...fields.map((field): [string, string] => {
        switch (field.builtinKey) {
          case "brand":
            return [field.label, nameOf(brands, product.brandId)];
          case "category":
            return [field.label, nameOf(categories, product.categoryId)];
          case "season":
            return [field.label, seasonLabelOf(product.seasonId)];
          case "material":
            return [field.label, product.material || "—"];
          case "originCountry":
            return [field.label, product.originCountry || "—"];
          case "careNote":
            return [field.label, product.careNote || "—"];
          default:
            return [field.label, product.customValues[field.id] || "—"];
        }
      }),
      ["販売価格 (税抜)", yen.format(product.currentPrice)],
      ["原価", yen.format(product.costPrice)],
      ["消費税率", `${Math.round(product.taxRate * 100)}%`],
      ["登録日", product.createdAt],
    ];
    return (
      <Card title="商品情報" action={headerAction} className={className}>
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 border-b border-ink-100 pb-2">
              <dt className="shrink-0 text-ink-400">{label}</dt>
              <dd className="text-right text-ink-800">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
    );
  }

  // ---- 編集モード ----
  return (
    <Card title="商品情報" action={headerAction} className={className}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs text-ink-500">品番 (変更不可)</span>
          <input value={product.styleCode} disabled className={`${inputClass} bg-ink-50 text-ink-400`} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-ink-500">商品名</span>
          <input value={form.name} onChange={(event) => set("name", event.target.value)} className={inputClass} />
        </label>
        {fields.map((field) => {
          if (field.builtinKey === "brand") {
            return (
              <label key={field.id} className="block">
                <span className="mb-1 block text-xs text-ink-500">{field.label}</span>
                <select value={form.brandId} onChange={(event) => set("brandId", event.target.value)} className={inputClass}>
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </label>
            );
          }
          if (field.builtinKey === "category") {
            return (
              <label key={field.id} className="block">
                <span className="mb-1 block text-xs text-ink-500">{field.label}</span>
                <select value={form.categoryId} onChange={(event) => set("categoryId", event.target.value)} className={inputClass}>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
            );
          }
          if (field.builtinKey === "season") {
            return (
              <label key={field.id} className="block">
                <span className="mb-1 block text-xs text-ink-500">{field.label}</span>
                <select value={form.seasonId} onChange={(event) => set("seasonId", event.target.value)} className={inputClass}>
                  {seasons.map((season) => (
                    <option key={season.id} value={season.id}>
                      {season.code ? `${season.code} · ${season.name}` : season.name}
                    </option>
                  ))}
                </select>
              </label>
            );
          }
          if (field.builtinKey === "material") {
            return (
              <label key={field.id} className="block">
                <span className="mb-1 block text-xs text-ink-500">{field.label}</span>
                <TextOrSelect value={form.material} onChange={(next) => set("material", next)} options={field.options} />
              </label>
            );
          }
          if (field.builtinKey === "originCountry") {
            return (
              <label key={field.id} className="block">
                <span className="mb-1 block text-xs text-ink-500">{field.label}</span>
                <TextOrSelect value={form.originCountry} onChange={(next) => set("originCountry", next)} options={field.options} />
              </label>
            );
          }
          if (field.builtinKey === "careNote") {
            return (
              <label key={field.id} className="block">
                <span className="mb-1 block text-xs text-ink-500">{field.label}</span>
                <TextOrSelect value={form.careNote} onChange={(next) => set("careNote", next)} options={field.options} />
              </label>
            );
          }
          return (
            <label key={field.id} className="block">
              <span className="mb-1 block text-xs text-ink-500">{field.label}</span>
              <TextOrSelect
                value={form.customValues[field.id] ?? ""}
                onChange={(next) =>
                  set("customValues", { ...form.customValues, [field.id]: next })
                }
                options={field.options}
              />
            </label>
          );
        })}
        <label className="block">
          <span className="mb-1 block text-xs text-ink-500">
            販売価格 (税抜) — 変更すると価格改定履歴に残ります
          </span>
          <input
            type="number"
            min={0}
            value={form.currentPrice}
            onChange={(event) => set("currentPrice", event.target.value)}
            className={`${inputClass} tabular text-right`}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-ink-500">原価</span>
          <input
            type="number"
            min={0}
            value={form.costPrice}
            onChange={(event) => set("costPrice", event.target.value)}
            className={`${inputClass} tabular text-right`}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-ink-500">消費税率</span>
          <select value={form.taxRate} onChange={(event) => set("taxRate", event.target.value)} className={inputClass}>
            <option value="10">10%</option>
            <option value="8">8% (軽減税率)</option>
          </select>
        </label>
      </div>
      {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending || !form.name.trim()}
          className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white hover:bg-ink-800 disabled:opacity-40"
        >
          {pending ? "保存中..." : "保存する"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={pending}
          className="rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm text-ink-600 hover:bg-ink-50"
        >
          キャンセル
        </button>
      </div>
    </Card>
  );
}
