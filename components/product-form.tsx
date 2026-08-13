"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import { createProduct, type CreateProductResult } from "@/app/(app)/products/new/actions";
import { JanMonthInput } from "@/components/jan-month-input";
import { buildSku, STANDARD_COLORS, STANDARD_SIZES } from "@/lib/apparel";

type Option = { id: string; name: string; code?: string };

/** 設定 (商品の基本情報 項目) で表示にした項目。builtinKey が null ならカスタム項目 */
export type FieldOption = { id: string; builtinKey: string | null; label: string };

const inputClass =
  "w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-400";
const labelClass = "mb-1 block text-xs text-ink-500";

/**
 * 商品 (品番) の新規登録フォーム。
 * カラー×サイズを選ぶと SKU が自動生成され、JAN コードの採番と初期在庫まで一度に登録する。
 */
export function ProductForm({
  brands,
  categories,
  seasons,
  stores,
  fields,
}: {
  brands: Option[];
  categories: Option[];
  seasons: Option[];
  stores: Option[];
  fields: FieldOption[];
}) {
  // 設定で表示にした項目だけをフォームに出す (非表示の組み込み項目は既定値で登録される)
  const showField = (key: string) => fields.some((field) => field.builtinKey === key);
  const customFields = fields.filter((field) => field.builtinKey === null);
  const [styleCode, setStyleCode] = useState("");
  const [name, setName] = useState("");
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [seasonId, setSeasonId] = useState(seasons[0]?.id ?? "");
  const [listPrice, setListPrice] = useState("");
  const [currentPrice, setCurrentPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [material, setMaterial] = useState("");
  const [originCountry, setOriginCountry] = useState("");
  const [careNote, setCareNote] = useState("");
  /** カスタム項目の入力値 (fieldId → value) */
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [colorCodes, setColorCodes] = useState<string[]>(["BLK"]);
  const [sizeCodes, setSizeCodes] = useState<string[]>(["S", "M", "L"]);
  const [generateBarcodes, setGenerateBarcodes] = useState(true);
  // JAN 採番の年月 "YYYY-MM" (490 + YYMM + 連番5桁 + チェックデジット)。既定は当月。
  // 入力欄では数字6桁 (YYYYMM) で受け、正規化できないあいだは null
  const [janYearMonth, setJanYearMonth] = useState<string | null>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [initialStock, setInitialStock] = useState("0");
  const [safetyStock, setSafetyStock] = useState("2");
  const [storeIds, setStoreIds] = useState<string[]>(stores.map((store) => store.id));
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<(CreateProductResult & { ok: true }) | null>(null);
  const [pending, startTransition] = useTransition();

  const selectedColors = STANDARD_COLORS.filter((color) => colorCodes.includes(color.code));
  const selectedSizes = STANDARD_SIZES.filter((size) => sizeCodes.includes(size.code));

  // 生成される SKU のプレビュー
  const skus = useMemo(() => {
    if (!styleCode.trim()) return [];
    return selectedColors.flatMap((color) =>
      selectedSizes.map((size) => ({
        sku: buildSku(styleCode, color.code, size.code),
        color,
        size,
      })),
    );
  }, [styleCode, selectedColors, selectedSizes]);

  const toggle = (list: string[], value: string, setter: (next: string[]) => void) =>
    setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const result = await createProduct({
        styleCode,
        name,
        brandId,
        categoryId,
        seasonId,
        listPrice: Number(listPrice) || 0,
        currentPrice: Number(currentPrice) || Number(listPrice) || 0,
        costPrice: Number(costPrice) || 0,
        taxRate: 0.1,
        material,
        originCountry,
        careNote,
        customFields: customFields
          .map((field) => ({ fieldId: field.id, value: (customValues[field.id] ?? "").trim() }))
          .filter((entry) => entry.value),
        colors: selectedColors.map((color) => ({
          code: color.code,
          name: color.name,
          hex: color.hex,
        })),
        sizes: selectedSizes.map((size) => ({ code: size.code, name: size.name })),
        generateBarcodes,
        janYearMonth: janYearMonth ?? undefined,
        initialStock: Number(initialStock) || 0,
        safetyStock: Number(safetyStock) || 0,
        storeIds,
      });
      if (result.ok) {
        setDone(result);
      } else {
        setError(result.error);
      }
    });

  // ---- 登録完了 ----
  if (done) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-ink-200 bg-white p-6 text-center">
        <p className="text-sm font-medium text-emerald-700">商品を登録しました</p>
        <p className="tabular mt-2 text-lg font-semibold text-ink-900">{done.styleCode}</p>
        <p className="mt-1 text-sm text-ink-600">
          {done.variantCount} SKU を作成
          {done.barcodeCount > 0 && ` / JAN コードを ${done.barcodeCount} 件採番`}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Link
            href={`/products/${done.productId}/labels`}
            className="rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink-800"
          >
            値札ラベル (バーコード) を印刷
          </Link>
          <Link
            href={`/products/${done.productId}`}
            className="rounded-lg border border-ink-200 bg-white px-4 py-2.5 text-sm text-ink-600 hover:bg-ink-50"
          >
            商品詳細を見る
          </Link>
          <button
            type="button"
            onClick={() => {
              setDone(null);
              setStyleCode("");
              setName("");
              setListPrice("");
              setCurrentPrice("");
            }}
            className="rounded-lg border border-ink-200 bg-white px-4 py-2.5 text-sm text-ink-600 hover:bg-ink-50"
          >
            続けて登録する
          </button>
        </div>
      </div>
    );
  }

  // ---- 入力フォーム ----
  return (
    <form
      className="grid grid-cols-1 gap-4 lg:grid-cols-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {/* 基本情報 */}
      <div className="min-w-0 space-y-4 lg:col-span-2">
        <div className="rounded-xl border border-ink-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink-800">基本情報</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={labelClass}>
                品番 <span className="text-rose-600">*</span>
              </span>
              <input
                value={styleCode}
                onChange={(event) => setStyleCode(event.target.value.toUpperCase())}
                placeholder="26AW-CT-010"
                required
                className={`${inputClass} tabular`}
              />
            </label>
            <label className="block">
              <span className={labelClass}>
                商品名 <span className="text-rose-600">*</span>
              </span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="ウールブレンドコート"
                required
                className={inputClass}
              />
            </label>
            {showField("brand") && (
              <label className="block">
                <span className={labelClass}>ブランド</span>
                <select
                  value={brandId}
                  onChange={(event) => setBrandId(event.target.value)}
                  className={`${inputClass} bg-white`}
                >
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {showField("category") && (
              <label className="block">
                <span className={labelClass}>カテゴリ</span>
                <select
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                  className={`${inputClass} bg-white`}
                >
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {showField("season") && (
              <label className="block">
                <span className={labelClass}>シーズン</span>
                <select
                  value={seasonId}
                  onChange={(event) => setSeasonId(event.target.value)}
                  className={`${inputClass} bg-white`}
                >
                  {seasons.map((season) => (
                    <option key={season.id} value={season.id}>
                      {season.code ? `${season.code} · ${season.name}` : season.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {/* 設定で追加したカスタム項目 (自由入力) */}
            {customFields.map((field) => (
              <label key={field.id} className="block">
                <span className={labelClass}>{field.label}</span>
                <input
                  value={customValues[field.id] ?? ""}
                  onChange={(event) =>
                    setCustomValues((prev) => ({ ...prev, [field.id]: event.target.value }))
                  }
                  className={inputClass}
                />
              </label>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-ink-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink-800">価格 (税抜)</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block">
              <span className={labelClass}>
                プロパー価格 <span className="text-rose-600">*</span>
              </span>
              <input
                type="number"
                min={0}
                value={listPrice}
                onChange={(event) => setListPrice(event.target.value)}
                placeholder="24000"
                required
                className={`${inputClass} tabular text-right`}
              />
            </label>
            <label className="block">
              <span className={labelClass}>販売価格</span>
              <input
                type="number"
                min={0}
                value={currentPrice}
                onChange={(event) => setCurrentPrice(event.target.value)}
                placeholder="未入力ならプロパーと同額"
                className={`${inputClass} tabular text-right`}
              />
            </label>
            <label className="block">
              <span className={labelClass}>原価</span>
              <input
                type="number"
                min={0}
                value={costPrice}
                onChange={(event) => setCostPrice(event.target.value)}
                placeholder="0"
                className={`${inputClass} tabular text-right`}
              />
            </label>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {showField("material") && (
              <label className="block">
                <span className={labelClass}>素材・組成</span>
                <input
                  value={material}
                  onChange={(event) => setMaterial(event.target.value)}
                  placeholder="ウール80% ナイロン20%"
                  className={inputClass}
                />
              </label>
            )}
            {showField("originCountry") && (
              <label className="block">
                <span className={labelClass}>原産国</span>
                <input
                  value={originCountry}
                  onChange={(event) => setOriginCountry(event.target.value)}
                  placeholder="日本"
                  className={inputClass}
                />
              </label>
            )}
            {showField("careNote") && (
              <label className="block">
                <span className={labelClass}>取扱い注意</span>
                <input
                  value={careNote}
                  onChange={(event) => setCareNote(event.target.value)}
                  placeholder="ドライクリーニング推奨"
                  className={inputClass}
                />
              </label>
            )}
          </div>
        </div>

        {/* カラー × サイズ */}
        <div className="rounded-xl border border-ink-200 bg-white p-5">
          <h2 className="mb-1 text-sm font-semibold text-ink-800">カラー × サイズ (SKU)</h2>
          <p className="mb-3 text-xs text-ink-400">
            選んだカラーとサイズの全組み合わせが SKU として作られます
          </p>

          <p className={labelClass}>カラー</p>
          <div className="flex flex-wrap gap-1.5">
            {STANDARD_COLORS.map((color) => {
              const on = colorCodes.includes(color.code);
              return (
                <button
                  key={color.code}
                  type="button"
                  onClick={() => toggle(colorCodes, color.code, setColorCodes)}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm transition-colors ${
                    on ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 bg-white text-ink-600 hover:bg-ink-50"
                  }`}
                >
                  <span
                    className="inline-block h-3 w-3 rounded-full border border-ink-200"
                    style={{ backgroundColor: color.hex }}
                  />
                  {color.name}
                </button>
              );
            })}
          </div>

          <p className={`${labelClass} mt-4`}>サイズ</p>
          <div className="flex flex-wrap gap-1.5">
            {STANDARD_SIZES.map((size) => {
              const on = sizeCodes.includes(size.code);
              return (
                <button
                  key={size.code}
                  type="button"
                  onClick={() => toggle(sizeCodes, size.code, setSizeCodes)}
                  className={`min-w-12 rounded-lg border px-2.5 py-1 text-sm transition-colors ${
                    on ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 bg-white text-ink-600 hover:bg-ink-50"
                  }`}
                >
                  {size.name}
                </button>
              );
            })}
          </div>

          <div className="mt-4 border-t border-ink-100 pt-3">
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                checked={generateBarcodes}
                onChange={(event) => setGenerateBarcodes(event.target.checked)}
                className="h-4 w-4 accent-ink-900"
              />
              SKU ごとに JAN コード (EAN-13) を自動採番する
            </label>
            {generateBarcodes && (
              <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
                <span className="flex items-center gap-2 text-sm text-ink-600">
                  採番年月
                  <JanMonthInput
                    defaultValue={(() => {
                      const now = new Date();
                      return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
                    })()}
                    onValueChange={setJanYearMonth}
                  />
                </span>
                <span className="text-xs text-ink-400">
                  数字6桁 (例: 202608)。コードは「年月 + 連番5桁」で自動採番されます
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 右: プレビューと初期在庫 */}
      <div className="min-w-0 space-y-4">
        <div className="rounded-xl border border-ink-200 bg-white p-5">
          <h2 className="mb-1 text-sm font-semibold text-ink-800">生成される SKU</h2>
          <p className="tabular mb-3 text-2xl font-semibold text-ink-900">
            {skus.length}
            <span className="ml-1 text-sm font-normal text-ink-400">
              件 ({selectedColors.length} 色 × {selectedSizes.length} サイズ)
            </span>
          </p>
          {skus.length === 0 ? (
            <p className="text-xs text-ink-400">
              品番とカラー・サイズを指定すると、ここに SKU が表示されます
            </p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg bg-ink-50 p-2">
              {skus.slice(0, 40).map((item) => (
                <li key={item.sku} className="tabular text-xs text-ink-600">
                  {item.sku}
                </li>
              ))}
              {skus.length > 40 && (
                <li className="text-xs text-ink-400">ほか {skus.length - 40} 件</li>
              )}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-ink-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink-800">初期在庫 (任意)</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelClass}>SKUあたり在庫数</span>
              <input
                type="number"
                min={0}
                value={initialStock}
                onChange={(event) => setInitialStock(event.target.value)}
                className={`${inputClass} tabular text-right`}
              />
            </label>
            <label className="block">
              <span className={labelClass}>発注点</span>
              <input
                type="number"
                min={0}
                value={safetyStock}
                onChange={(event) => setSafetyStock(event.target.value)}
                className={`${inputClass} tabular text-right`}
              />
            </label>
          </div>
          <p className={`${labelClass} mt-3`}>配置する店舗</p>
          <div className="space-y-1.5">
            {stores.map((store) => (
              <label key={store.id} className="flex items-center gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  checked={storeIds.includes(store.id)}
                  onChange={() => toggle(storeIds, store.id, setStoreIds)}
                  className="h-4 w-4 accent-ink-900"
                />
                {store.name}
              </label>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-ink-200 bg-white p-5">
          {error && <p className="mb-3 text-sm text-rose-700">{error}</p>}
          <button
            type="submit"
            disabled={
              pending ||
              skus.length === 0 ||
              !name.trim() ||
              !listPrice ||
              // 採番する場合は年月 (数字6桁) が正しく入力されていること
              (generateBarcodes && !janYearMonth)
            }
            className="w-full rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink-800 disabled:opacity-40"
          >
            {pending ? "登録中..." : `${skus.length} SKU を登録する`}
          </button>
          <p className="mt-2 text-center text-xs text-ink-400">
            登録後、値札ラベル (バーコード) をそのまま印刷できます
          </p>
        </div>
      </div>
    </form>
  );
}
