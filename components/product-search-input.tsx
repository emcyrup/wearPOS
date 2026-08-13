"use client";

import { useRef, useState } from "react";

import { ScanButton } from "@/components/barcode-scanner";

/**
 * 商品一覧の検索入力。バーコードスキャンを組み込み、
 * 読み取った JAN / SKU をそのまま検索条件にして絞り込む。
 */
export function ProductSearchInput({ defaultValue }: { defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="flex gap-1.5">
      <input
        ref={inputRef}
        type="search"
        name="q"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="26SS-SH-001 / シャツ / JAN"
        className="w-56 rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-ink-400"
      />
      <ScanButton
        onDetect={(code) => {
          setValue(code);
          // 読み取り値を反映してからフォームを送信して絞り込む
          requestAnimationFrame(() => inputRef.current?.form?.requestSubmit());
        }}
      />
    </div>
  );
}
