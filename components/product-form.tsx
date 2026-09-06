"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { createProduct, type CreateProductResult } from "@/app/(app)/products/new/actions";
import { BarcodeScanner, ScanButton } from "@/components/barcode-scanner";
import { JanMonthInput } from "@/components/jan-month-input";
import {
  autoStyleCodeExample,
  buildSku,
  NO_COLOR,
  STANDARD_COLORS,
  STANDARD_SIZES,
} from "@/lib/apparel";
import { MULTI_STORE } from "@/lib/config";

type Option = { id: string; name: string; code?: string };

/** 設定 (商品の基本情報 項目) で表示にした項目。builtinKey が null ならカスタム項目 */
export type FieldOption = {
  id: string;
  builtinKey: string | null;
  label: string;
  /** カスタム項目の選択肢 (空なら自由入力) */
  options: string[];
};

const inputClass =
  "w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-400";
const labelClass = "mb-1 block text-xs text-ink-500";

/** 設定で選択肢を登録した項目はドロップダウン、なければ自由入力 */
function TextOrSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  options: string[];
  placeholder?: string;
}) {
  if (options.length > 0) {
    return (
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`${inputClass} bg-white`}
      >
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
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={inputClass}
    />
  );
}

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
  initialBarcode,
}: {
  brands: Option[];
  categories: Option[];
  seasons: Option[];
  stores: Option[];
  fields: FieldOption[];
  /** レジで読み取った未登録バーコード。指定時は「既存バーコード」モードで開く */
  initialBarcode?: string;
}) {
  // フォームには設定 (商品の基本情報 項目) で表示にした項目が、設定した並び順で出る。
  // 非表示の組み込み項目は既定値で登録される
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
  /** バーコードの付け方: 自動採番 / 既存バーコードを読み取り / あとで設定 */
  const [barcodeMode, setBarcodeMode] = useState<"AUTO" | "MANUAL" | "NONE">(
    initialBarcode ? "MANUAL" : "AUTO",
  );
  /** MANUAL のときの SKU ごとのバーコード (sku → コード) */
  const [manualBarcodes, setManualBarcodes] = useState<Record<string, string>>({});
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
  /** 品番を空欄にしたときに採番される形の見本 */
  const autoStyleExample = useMemo(() => autoStyleCodeExample(), []);

  // 生成される SKU のプレビュー。
  // 品番とカラーは任意なので、未入力・未選択でも組み合わせは決まる
  // (品番は登録時に自動採番、カラーは「指定なし」1つとして扱う)
  const skus = useMemo(() => {
    const style = styleCode.trim();
    const colors: { code: string; name: string; hex?: string; skuPart: string }[] =
      selectedColors.length > 0
        ? selectedColors.map((color) => ({ ...color, skuPart: color.code }))
        : [{ code: NO_COLOR.code, name: NO_COLOR.name, skuPart: "" }];

    return colors.flatMap((color) =>
      selectedSizes.map((size) => ({
        // 入力欄の対応づけに使うキー。品番が決まっていなくても変わらない
        key: `${color.code}-${size.code}`,
        // 画面に出す SKU。品番が空のあいだは組み合わせだけを見せる
        sku: style ? buildSku(style, color.skuPart, size.code) : "",
        label: `${color.name} / ${size.name}`,
        color,
        size,
      })),
    );
  }, [styleCode, selectedColors, selectedSizes]);

  /** 既存バーコードの読み取り: まとめて読み取りのカメラを開いているか */
  const [bulkScanOpen, setBulkScanOpen] = useState(false);
  /** SKU ごとの入力欄。ハードウェアのリーダーで次の空欄へ移るために持つ */
  const barcodeInputs = useRef<Record<string, HTMLInputElement | null>>({});
  /** カラー・サイズの選択セクション (未選択のときにここへ案内する) */
  const skuSectionRef = useRef<HTMLDivElement>(null);

  const scannedCount = skus.filter((item) => (manualBarcodes[item.key] ?? "").trim()).length;
  /** これから読み取る SKU (上から順に空いているもの) */
  const nextEmpty = skus.find((item) => !(manualBarcodes[item.key] ?? "").trim()) ?? null;
  const nextEmptyLabel = nextEmpty ? nextEmpty.sku || nextEmpty.label : null;

  /** 同じ値札を二度読みしていないか (登録前に画面で気づけるようにする) */
  const duplicatedBarcodes = useMemo(() => {
    const seen = new Set<string>();
    const duplicated = new Set<string>();
    for (const item of skus) {
      const value = (manualBarcodes[item.key] ?? "").trim();
      if (!value) continue;
      if (seen.has(value)) duplicated.add(value);
      else seen.add(value);
    }
    return duplicated;
  }, [skus, manualBarcodes]);

  // レジから持ち込んだバーコードは、SKU が決まった時点で先頭の SKU に入れておく
  const prefilled = useRef(false);
  useEffect(() => {
    if (!initialBarcode || prefilled.current || skus.length === 0) return;
    prefilled.current = true;
    setManualBarcodes((prev) => ({ [skus[0].key]: initialBarcode, ...prev }));
  }, [initialBarcode, skus]);

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
        barcodeMode,
        manualBarcodes:
          barcodeMode === "MANUAL"
            ? // 並び順 (カラー × サイズ) でサーバー側の SKU と突き合わせる。
              // 品番を自動採番するときは、この時点では SKU 名が決まっていない
              skus.map((item) => ({
                sku: item.sku || item.key,
                barcode: manualBarcodes[item.key] ?? "",
              }))
            : [],
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
              <span className={labelClass}>品番 (任意)</span>
              <input
                value={styleCode}
                onChange={(event) => setStyleCode(event.target.value.toUpperCase())}
                placeholder="26AW-CT-010"
                className={`${inputClass} tabular`}
              />
              <span className="mt-1 block text-xs text-ink-400">
                空欄なら自動で採番します (例: {autoStyleExample})
              </span>
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
          </div>

          {/* バーコード (品番のすぐ下)。自動採番と既存バーコードの読み取りを選べる */}
          <div className="mt-3 rounded-lg bg-ink-50 px-3.5 py-3">
            <p className="mb-2 text-xs font-medium text-ink-500">バーコード</p>
            <div className="space-y-1.5">
              {(
                [
                  { value: "AUTO", label: "自店で自動採番する", hint: "JAN (EAN-13) を「年月 + 連番5桁」で発行します" },
                  {
                    value: "MANUAL",
                    label: "既存のバーコードを読み取って登録する",
                    hint: "メーカーの値札や自店の旧ラベルをそのまま使えます (値札の付け替え不要)",
                  },
                  { value: "NONE", label: "あとで設定する", hint: "商品詳細の SKU 一覧からいつでも登録できます" },
                ] as const
              ).map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer gap-2.5 rounded-lg border p-2.5 transition-colors ${
                    barcodeMode === option.value
                      ? "border-ink-900 bg-white"
                      : "border-ink-200 bg-white/60 hover:bg-white"
                  }`}
                >
                  <input
                    type="radio"
                    name="barcodeMode"
                    checked={barcodeMode === option.value}
                    onChange={() => setBarcodeMode(option.value)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-ink-900"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink-800">{option.label}</span>
                    <span className="mt-0.5 block text-xs text-ink-400">{option.hint}</span>
                  </span>
                </label>
              ))}
            </div>

            {barcodeMode === "AUTO" && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
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
                  数字6桁 (例: 202608)。「年月 + 連番5桁」で自動採番されます
                </span>
              </div>
            )}

            {barcodeMode === "MANUAL" && (
              <div className="mt-2.5">
                {initialBarcode && (
                  <p className="mb-2 rounded-lg bg-white px-3 py-2 text-xs text-ink-600">
                    レジで読み取ったバーコード
                    <span className="tabular ml-1 font-medium text-ink-900">{initialBarcode}</span>
                    を、最初の SKU に設定します
                  </p>
                )}
                {skus.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-ink-300 bg-white px-3 py-3">
                    <p className="text-xs text-ink-600">
                      先に<span className="font-medium">サイズ</span>を選んでください。
                      読み取り用の入力欄が出ます
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        skuSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
                      }
                      className="mt-2 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50"
                    >
                      カラー・サイズを選ぶ ↓
                    </button>
                  </div>
                ) : (
                  <>
                    {/* まとめて読み取り: カメラを開いたまま、値札を順番にかざしていく */}
                    <div className="mb-2 rounded-lg border border-ink-200 bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-ink-800">
                            値札をまとめて読み取る
                          </span>
                          <span className="mt-0.5 block text-xs text-ink-400">
                            カメラを開いたまま、値札を1枚ずつかざすと上から順に入ります
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setBulkScanOpen(true)}
                          disabled={nextEmpty === null}
                          className="shrink-0 rounded-lg bg-ink-900 px-3.5 py-1.5 text-sm font-medium whitespace-nowrap text-white hover:bg-ink-800 disabled:opacity-40"
                        >
                          📷 まとめて読み取る
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-ink-500">
                        {scannedCount} / {skus.length} 読み取り済み
                        {nextEmptyLabel && (
                          <span className="ml-1 text-ink-400">（次: {nextEmptyLabel}）</span>
                        )}
                      </p>
                      <p className="mt-1 text-xs text-ink-400">
                        USB / Bluetooth のバーコードリーダーをお使いの場合は、下の入力欄を選んで
                        そのまま読み取ってください。1つ読むと次の空欄へ自動で移ります
                      </p>
                    </div>

                    <p className="mb-2 text-xs text-ink-400">
                      空欄のままにした SKU は、あとから商品詳細で登録できます
                    </p>
                    <div className="space-y-1.5">
                      {skus.map((item, index) => {
                        const value = manualBarcodes[item.key] ?? "";
                        const duplicated = value !== "" && duplicatedBarcodes.has(value);
                        // 品番を入れる前は SKU 名が決まらないので、カラー / サイズで見分ける
                        const rowName = item.sku || item.label;
                        return (
                          <div key={item.key} className="flex flex-wrap items-center gap-2">
                            <span className="tabular w-full text-xs text-ink-500 sm:w-56">
                              {rowName}
                            </span>
                            <span className="flex min-w-0 flex-1 gap-1.5">
                              <input
                                ref={(element) => {
                                  barcodeInputs.current[item.key] = element;
                                }}
                                value={value}
                                onChange={(event) =>
                                  setManualBarcodes((prev) => ({
                                    ...prev,
                                    [item.key]: event.target.value.trim(),
                                  }))
                                }
                                onKeyDown={(event) => {
                                  // ハードウェアのリーダーは読み取りの最後に Enter を送る。
                                  // 送信せず、次の空欄へ移って続けて読めるようにする
                                  if (event.key !== "Enter") return;
                                  event.preventDefault();
                                  const next = skus
                                    .slice(index + 1)
                                    .find((row) => !(manualBarcodes[row.key] ?? "").trim());
                                  if (next) barcodeInputs.current[next.key]?.focus();
                                  else event.currentTarget.blur();
                                }}
                                placeholder="値札のバーコードをスキャン"
                                aria-label={`${rowName} のバーコード`}
                                className={`${inputClass} tabular min-w-0 flex-1 ${
                                  duplicated ? "border-rose-400" : ""
                                }`}
                              />
                              <ScanButton
                                onDetect={(scanned) =>
                                  setManualBarcodes((prev) => ({ ...prev, [item.key]: scanned }))
                                }
                              />
                            </span>
                            {duplicated && (
                              <span className="w-full text-xs text-rose-700 sm:pl-56">
                                同じバーコードが他の SKU にも入っています
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* 設定 (商品の基本情報 項目) の表示・並び順どおりにレンダリングする */}
            {fields.map((field) => {
              if (field.builtinKey === "brand") {
                return (
                  <label key={field.id} className="block">
                    <span className={labelClass}>{field.label}</span>
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
                );
              }
              if (field.builtinKey === "category") {
                return (
                  <label key={field.id} className="block">
                    <span className={labelClass}>{field.label}</span>
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
                );
              }
              if (field.builtinKey === "season") {
                return (
                  <label key={field.id} className="block">
                    <span className={labelClass}>{field.label}</span>
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
                );
              }
              if (field.builtinKey === "material") {
                return (
                  <label key={field.id} className="block">
                    <span className={labelClass}>{field.label}</span>
                    <TextOrSelect
                      value={material}
                      onChange={setMaterial}
                      options={field.options}
                      placeholder="ウール80% ナイロン20%"
                    />
                  </label>
                );
              }
              if (field.builtinKey === "originCountry") {
                return (
                  <label key={field.id} className="block">
                    <span className={labelClass}>{field.label}</span>
                    <TextOrSelect
                      value={originCountry}
                      onChange={setOriginCountry}
                      options={field.options}
                      placeholder="日本"
                    />
                  </label>
                );
              }
              if (field.builtinKey === "careNote") {
                return (
                  <label key={field.id} className="block">
                    <span className={labelClass}>{field.label}</span>
                    <TextOrSelect
                      value={careNote}
                      onChange={setCareNote}
                      options={field.options}
                      placeholder="ドライクリーニング推奨"
                    />
                  </label>
                );
              }
              // カスタム項目
              return (
                <label key={field.id} className="block">
                  <span className={labelClass}>{field.label}</span>
                  <TextOrSelect
                    value={customValues[field.id] ?? ""}
                    onChange={(next) =>
                      setCustomValues((prev) => ({ ...prev, [field.id]: next }))
                    }
                    options={field.options}
                  />
                </label>
              );
            })}
          </div>

          {/* カラー × サイズ (選んだ全組み合わせが SKU になる) */}
          <div ref={skuSectionRef} className="mt-4 scroll-mt-4 border-t border-ink-100 pt-4">
            <h3 className="mb-1 text-sm font-semibold text-ink-800">カラー × サイズ (SKU)</h3>
            <p className="mb-3 text-xs text-ink-400">
              選んだカラーとサイズの全組み合わせが SKU として作られます
            </p>

            <p className={labelClass}>カラー (任意)</p>
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

            {selectedColors.length === 0 && (
              <p className="mt-1.5 text-xs text-ink-500">
                カラーを選ばない場合は「{NO_COLOR.name}」1つとして、サイズごとの SKU を作ります
                (小物・雑貨などカラー展開のない商品向け)
              </p>
            )}

            <p className={`${labelClass} mt-4`}>
              サイズ <span className="text-rose-600">*</span>
            </p>
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
        </div>

      </div>

      {/* 右: プレビューと初期在庫 */}
      <div className="min-w-0 space-y-4">
        <div className="rounded-xl border border-ink-200 bg-white p-5">
          <h2 className="mb-1 text-sm font-semibold text-ink-800">生成される SKU</h2>
          <p className="tabular mb-3 text-2xl font-semibold text-ink-900">
            {skus.length}
            <span className="ml-1 text-sm font-normal text-ink-400">
              件 ({selectedColors.length || 1} 色 × {selectedSizes.length} サイズ)
            </span>
          </p>
          {skus.length === 0 ? (
            <p className="text-xs text-ink-400">
              サイズを選ぶと、ここに SKU が表示されます
            </p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg bg-ink-50 p-2">
              {skus.slice(0, 40).map((item) => (
                <li key={item.key} className="tabular text-xs text-ink-600">
                  {item.sku || `（品番は自動採番）${item.label}`}
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
          {/* 単店舗運用 (MULTI_STORE=false) では店舗の選択を出さず、全店舗=自店に配置する */}
          {MULTI_STORE && (
            <>
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
            </>
          )}
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
              // 自動採番する場合は年月 (数字6桁) が正しく入力されていること
              (barcodeMode === "AUTO" && !janYearMonth)
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

      {/* 値札をまとめて読み取る。カメラを開いたまま、空いている SKU に上から入れていく */}
      {bulkScanOpen && (
        <BarcodeScanner
          continuous
          title="値札をまとめて読み取る"
          hint={
            nextEmptyLabel
              ? `${scannedCount} / ${skus.length} 読み取り済み — 次: ${nextEmptyLabel}`
              : `${skus.length} 件すべて読み取りました`
          }
          onDetect={(code) => {
            setManualBarcodes((prev) => {
              // 直前の状態から空いている SKU を探す (連続読み取りで取りこぼさないため)
              const target = skus.find((item) => !(prev[item.key] ?? "").trim());
              if (!target) return prev;
              return { ...prev, [target.key]: code };
            });
          }}
          onClose={() => setBulkScanOpen(false)}
        />
      )}
    </form>
  );
}
