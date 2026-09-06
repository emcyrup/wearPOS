"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import {
  importProductCsv,
  previewProductCsv,
  type ImportResult,
  type PreviewResult,
} from "@/app/(app)/products/import/actions";
import { Card } from "@/components/ui";
import { CSV_COLUMN_LABEL, REQUIRED_COLUMNS, type CsvColumnKey } from "@/lib/product-csv";

const STATUS_LABEL: Record<string, string> = {
  NEW: "新規",
  UPDATE: "更新",
  SKIP: "変更なし",
  ERROR: "エラー",
};

const STATUS_TONE: Record<string, string> = {
  NEW: "bg-emerald-100 text-emerald-800",
  UPDATE: "bg-sky-100 text-sky-800",
  SKIP: "bg-ink-100 text-ink-600",
  ERROR: "bg-rose-100 text-rose-800",
};

const OPTIONAL_COLUMNS = (Object.keys(CSV_COLUMN_LABEL) as CsvColumnKey[]).filter(
  (key) => !REQUIRED_COLUMNS.includes(key),
);

/**
 * 商品 CSV の取込画面。
 * 「読み込む → プレビューで確認 → 取り込む」の 2 段階にして、
 * 何件が新規で何件が更新なのかを見てから実行できるようにする。
 */
export function ProductCsvImport({
  stores,
  multiStore,
  sample,
}: {
  stores: { id: string; code: string; name: string }[];
  multiStore: boolean;
  sample: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState("");
  const [updateExisting, setUpdateExisting] = useState(false);
  const [createMasters, setCreateMasters] = useState(true);
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [withStock, setWithStock] = useState(true);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  const options = {
    updateExisting,
    createMasters,
    storeId: withStock ? storeId : "",
  };

  const runPreview = () =>
    startTransition(async () => {
      setResult(null);
      setPreview(await previewProductCsv(csv, options));
    });

  const runImport = () =>
    startTransition(async () => {
      const imported = await importProductCsv(csv, options);
      setResult(imported);
      if (imported.ok) {
        setPreview(null);
        router.refresh();
      }
    });

  const readFile = async (file: File) => {
    const text = await file.text();
    setCsv(text);
    setPreview(null);
    setResult(null);
  };

  return (
    <div className="space-y-4">
      <Card title="1. CSV を読み込む">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv"
            aria-label="CSV ファイル"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readFile(file);
            }}
            className="text-sm text-ink-600 file:mr-3 file:rounded-lg file:border file:border-ink-200 file:bg-white file:px-3 file:py-1.5 file:text-sm file:text-ink-600 hover:file:bg-ink-50"
          />
          <button
            type="button"
            onClick={() => {
              setCsv(sample);
              setPreview(null);
              setResult(null);
            }}
            className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50"
          >
            見本を入れる
          </button>
        </div>

        <textarea
          value={csv}
          onChange={(event) => {
            setCsv(event.target.value);
            setPreview(null);
            setResult(null);
          }}
          rows={8}
          aria-label="CSV の内容"
          placeholder="ファイルを選ぶか、Excel からコピーしてここに貼り付けてください"
          className="mt-3 w-full rounded-lg border border-ink-200 px-3 py-2 font-mono text-xs outline-none focus:border-ink-400"
        />

        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-ink-500 hover:text-ink-700">
            使える列の見出し
          </summary>
          <div className="mt-2 space-y-2 text-xs text-ink-600">
            <p>
              <span className="font-medium text-ink-800">必須:</span>{" "}
              {REQUIRED_COLUMNS.map((key) => CSV_COLUMN_LABEL[key]).join(" / ")}
            </p>
            <p>
              <span className="font-medium text-ink-800">任意:</span>{" "}
              {OPTIONAL_COLUMNS.map((key) => CSV_COLUMN_LABEL[key]).join(" / ")}
            </p>
            <p className="text-ink-400">
              列の順番は自由です。見出しは英語 (style_code, jan, list_price など) でも読み取れます。
              1行 = 1つの SKU (カラー × サイズ) として、同じ品番の行をまとめて 1商品にします。
              JAN が空の行は、あとから商品詳細で登録できます。
            </p>
          </div>
        </details>
      </Card>

      <Card title="2. 取込の設定">
        <div className="space-y-2">
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-ink-200 p-3 text-sm">
            <input
              type="checkbox"
              checked={updateExisting}
              onChange={(event) => {
                setUpdateExisting(event.target.checked);
                setPreview(null);
              }}
              className="mt-0.5 h-4 w-4 shrink-0 accent-ink-900"
            />
            <span className="min-w-0">
              <span className="block font-medium text-ink-800">
                すでにある商品・SKU の内容も上書きする
              </span>
              <span className="mt-0.5 block text-xs text-ink-400">
                商品名・上代・販売価格・JAN を CSV の内容で更新します。
                オフのときは新しい品番と SKU だけを追加し、JAN が未設定のものにだけ JAN を入れます
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-ink-200 p-3 text-sm">
            <input
              type="checkbox"
              checked={createMasters}
              onChange={(event) => {
                setCreateMasters(event.target.checked);
                setPreview(null);
              }}
              className="mt-0.5 h-4 w-4 shrink-0 accent-ink-900"
            />
            <span className="min-w-0">
              <span className="block font-medium text-ink-800">
                ブランド・カテゴリ・シーズンが無ければ自動で作る
              </span>
              <span className="mt-0.5 block text-xs text-ink-400">
                シーズンは 2026SS のような形式で書いてください
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-ink-200 p-3 text-sm">
            <input
              type="checkbox"
              checked={withStock}
              onChange={(event) => {
                setWithStock(event.target.checked);
                setPreview(null);
              }}
              className="mt-0.5 h-4 w-4 shrink-0 accent-ink-900"
            />
            <span className="min-w-0">
              <span className="block font-medium text-ink-800">在庫数も取り込む</span>
              <span className="mt-0.5 block text-xs text-ink-400">
                CSV の「在庫数」列を入荷として計上します（在庫の変動履歴にも残ります）
              </span>
              {withStock && multiStore && stores.length > 1 && (
                <select
                  value={storeId}
                  aria-label="在庫を入れる店舗"
                  onChange={(event) => {
                    setStoreId(event.target.value);
                    setPreview(null);
                  }}
                  className="mt-2 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-ink-400"
                >
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
              )}
            </span>
          </label>
        </div>

        <div className="mt-3">
          <button
            type="button"
            onClick={runPreview}
            disabled={pending || csv.trim() === ""}
            className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-40"
          >
            {pending ? "確認中..." : "内容を確認する"}
          </button>
        </div>
      </Card>

      {preview && !preview.ok && (
        <p className="rounded-lg bg-rose-50 px-4 py-2.5 text-sm text-rose-800">{preview.error}</p>
      )}

      {preview?.ok && (
        <Card title="3. 取り込む内容の確認">
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="rounded-lg bg-emerald-50 px-3 py-1.5 text-emerald-800">
              新規 {preview.counts.new} 件
            </span>
            <span className="rounded-lg bg-sky-50 px-3 py-1.5 text-sky-800">
              更新 {preview.counts.update} 件
            </span>
            <span className="rounded-lg bg-ink-50 px-3 py-1.5 text-ink-600">
              変更なし {preview.counts.skip} 件
            </span>
            <span
              className={`rounded-lg px-3 py-1.5 ${
                preview.counts.error > 0 ? "bg-rose-50 text-rose-800" : "bg-ink-50 text-ink-400"
              }`}
            >
              エラー {preview.counts.error} 件
            </span>
          </div>

          {(preview.newMasters.brands.length > 0 ||
            preview.newMasters.categories.length > 0 ||
            preview.newMasters.seasons.length > 0) && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              次のマスタを新しく作ります:{" "}
              {[
                ...preview.newMasters.brands.map((v) => `ブランド「${v}」`),
                ...preview.newMasters.categories.map((v) => `カテゴリ「${v}」`),
                ...preview.newMasters.seasons.map((v) => `シーズン「${v}」`),
              ].join(" / ")}
            </p>
          )}

          {preview.counts.error > 0 && (
            <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
              エラーの行があるため取り込めません。CSV を直してから、もう一度「内容を確認する」を押してください。
            </p>
          )}

          {/* 行数が多いので、スマホでも読めるよう横スクロールさせる */}
          <div className="mt-3 max-h-96 overflow-auto rounded-lg border border-ink-200">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-ink-50">
                <tr>
                  {["行", "状態", "品番", "商品名", "SKU", "JAN", "上代", "在庫", "内容"].map(
                    (head) => (
                      <th
                        key={head}
                        className="border-b border-ink-200 px-2 py-2 text-left text-xs font-semibold whitespace-nowrap text-ink-500"
                      >
                        {head}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.lineNo} className="border-b border-ink-100 last:border-0">
                    <td className="tabular px-2 py-1.5 text-xs text-ink-400">{row.lineNo}</td>
                    <td className="px-2 py-1.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${STATUS_TONE[row.status]}`}
                      >
                        {STATUS_LABEL[row.status]}
                      </span>
                    </td>
                    <td className="tabular px-2 py-1.5 text-xs whitespace-nowrap">
                      {row.styleCode || <span className="text-ink-400">自動採番</span>}
                    </td>
                    <td className="px-2 py-1.5 text-xs">{row.name}</td>
                    <td className="tabular px-2 py-1.5 text-xs whitespace-nowrap text-ink-500">
                      {row.sku || `${row.colorName} / ${row.sizeName}`}
                    </td>
                    <td className="tabular px-2 py-1.5 text-xs whitespace-nowrap text-ink-500">
                      {row.barcode || "—"}
                    </td>
                    <td className="tabular px-2 py-1.5 text-xs whitespace-nowrap">
                      {row.listPrice === null ? "—" : row.listPrice.toLocaleString("ja-JP")}
                    </td>
                    <td className="tabular px-2 py-1.5 text-xs">{row.stock ?? "—"}</td>
                    <td
                      className={`px-2 py-1.5 text-xs ${
                        row.status === "ERROR" ? "text-rose-700" : "text-ink-400"
                      }`}
                    >
                      {row.messages.join(" / ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            onClick={runImport}
            disabled={
              pending || preview.counts.error > 0 || preview.counts.new + preview.counts.update === 0
            }
            className="mt-3 rounded-lg bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-40"
          >
            {pending
              ? "取込中..."
              : `${preview.counts.new + preview.counts.update} 件を取り込む`}
          </button>
        </Card>
      )}

      {result && !result.ok && (
        <p className="rounded-lg bg-rose-50 px-4 py-2.5 text-sm text-rose-800">{result.error}</p>
      )}

      {result?.ok && (
        <Card title="取込が完了しました">
          <ul className="space-y-1 text-sm text-ink-600">
            <li>
              商品 (品番): 新規 {result.products.created} 件 / 更新 {result.products.updated} 件
            </li>
            <li>
              SKU: 新規 {result.variants.created} 件 / 更新 {result.variants.updated} 件
            </li>
            <li>JAN を設定: {result.barcodes} 件</li>
            <li>在庫を計上: {result.stock} 点</li>
            {result.skipped > 0 && <li className="text-ink-400">変更なし: {result.skipped} 件</li>}
          </ul>
          <a
            href="/products"
            className="mt-3 inline-block rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50"
          >
            商品一覧を見る
          </a>
        </Card>
      )}
    </div>
  );
}
