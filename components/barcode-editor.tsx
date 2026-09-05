"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { updateVariantBarcode } from "@/app/(app)/products/[id]/actions";
import { Barcode } from "@/components/barcode";
import { ScanButton } from "@/components/barcode-scanner";

/**
 * SKU 一覧のバーコードをその場で登録・変更する。
 * メーカーの値札や自店の旧ラベルを読み取って、そのまま SKU に紐づけられる。
 */
export function BarcodeEditor({
  variantId,
  sku,
  barcode,
  canEdit,
}: {
  variantId: string;
  sku: string;
  barcode: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(barcode ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    startTransition(async () => {
      const result = await updateVariantBarcode({ variantId, barcode: value });
      if (result.ok) {
        setEditing(false);
        setError(null);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  if (!editing) {
    return (
      <span className="flex items-center gap-1.5">
        {barcode ? (
          <Barcode code={barcode} moduleWidth={1.2} height={28} />
        ) : (
          <span className="text-xs text-ink-400">未設定</span>
        )}
        {canEdit && (
          <button
            type="button"
            aria-label={`${sku} のバーコードを設定`}
            onClick={() => {
              setValue(barcode ?? "");
              setError(null);
              setEditing(true);
            }}
            className="rounded px-1.5 py-1 text-xs text-ink-400 hover:bg-ink-100 hover:text-ink-600"
          >
            ✎
          </button>
        )}
      </span>
    );
  }

  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5">
        <input
          value={value}
          onChange={(event) => setValue(event.target.value.trim())}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              save();
            }
            if (event.key === "Escape") setEditing(false);
          }}
          autoFocus
          aria-label={`${sku} のバーコード`}
          placeholder="値札のバーコードをスキャン"
          className="tabular w-44 rounded border border-ink-200 px-2 py-1 text-xs outline-none focus:border-ink-400"
        />
        <ScanButton onDetect={setValue} />
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded bg-ink-900 px-2 py-1 text-xs font-medium text-white hover:bg-ink-800 disabled:opacity-50"
        >
          {pending ? "保存中..." : "保存"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded px-1.5 py-1 text-xs text-ink-400 hover:text-ink-600"
        >
          取消
        </button>
      </span>
      {error && <span className="text-xs text-rose-700">{error}</span>}
      <span className="text-[11px] text-ink-400">
        空欄で保存すると未設定に戻ります
      </span>
    </span>
  );
}
