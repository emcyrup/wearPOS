"use client";

import { MULTI_STORE } from "@/lib/config";
import Link from "next/link";
import { useCallback, useState } from "react";

import { ScanButton } from "@/components/barcode-scanner";

type LookupResult = {
  found: boolean;
  productId: string;
  productName: string;
  styleCode: string;
  seasonCode: string;
  price: number;
  listPrice: number;
  sku: string;
  barcode: string | null;
  colorName: string;
  sizeName: string;
  stock: { storeName: string; quantity: number }[];
};

const yen = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

/**
 * スキャン (またはコード入力) → 商品照会 → 結果表示。
 * USB / Bluetooth のバーコードリーダーは入力欄に打鍵するだけで動く
 * (リーダーは末尾に Enter を送るのが一般的なので、フォーム送信で照会が走る)。
 */
export function ScanLookup() {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<LookupResult | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const lookup = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setLoading(true);
    setNotFound(null);
    setResult(null);
    try {
      const response = await fetch(`/api/barcode-lookup?code=${encodeURIComponent(trimmed)}`);
      if (response.ok) {
        setResult((await response.json()) as LookupResult);
      } else {
        setNotFound(trimmed);
      }
    } catch {
      setNotFound(trimmed);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="max-w-xl space-y-4">
      <form
        className="rounded-xl border border-ink-200 bg-white p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void lookup(code);
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-400">JAN コード / SKU</span>
          <span className="flex gap-2">
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="4912345678904 / 26SS-SH-001-BLK-M"
              autoComplete="off"
              autoFocus
              className="tabular w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-400"
            />
            <ScanButton
              onDetect={(value) => {
                setCode(value);
                void lookup(value);
              }}
            />
          </span>
        </label>
        <button
          type="submit"
          disabled={loading}
          className="mt-3 rounded-lg bg-ink-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-50"
        >
          {loading ? "照会中..." : "照会する"}
        </button>
      </form>

      {notFound && (
        <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">
          「{notFound}」に一致する商品が見つかりませんでした。
        </p>
      )}

      {result && (
        <div className="rounded-xl border border-ink-200 bg-white p-5">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <Link
                href={`/products/${result.productId}`}
                className="text-base font-semibold text-ink-900 hover:text-accent"
              >
                {result.productName}
              </Link>
              <p className="mt-0.5 text-xs text-ink-400">
                {result.styleCode} · {result.seasonCode} · {result.colorName} / {result.sizeName}
              </p>
              <p className="tabular mt-0.5 text-xs text-ink-400">{result.sku}</p>
            </div>
            <div className="text-right">
              <p className="tabular text-xl font-semibold">{yen.format(result.price)}</p>
              {result.price < result.listPrice && (
                <p className="tabular text-xs text-ink-400 line-through">
                  {yen.format(result.listPrice)}
                </p>
              )}
            </div>
          </div>

          <table className="mt-4 w-full border-t border-ink-100 text-sm">
            <tbody>
              {(MULTI_STORE
                ? result.stock
                : [
                    {
                      storeName: "在庫",
                      quantity: result.stock.reduce((sum, row) => sum + row.quantity, 0),
                    },
                  ]
              ).map((row) => (
                <tr key={row.storeName} className="border-b border-ink-100 last:border-0">
                  <td className="py-2 text-ink-600">{row.storeName}</td>
                  <td
                    className={`tabular py-2 text-right font-medium ${
                      row.quantity <= 0 ? "text-rose-700" : "text-ink-900"
                    }`}
                  >
                    {row.quantity <= 0 ? "在庫なし" : `${row.quantity} 点`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
