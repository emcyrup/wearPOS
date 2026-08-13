"use client";

import { useRef, useState } from "react";

/** "YYYYMM" (数字6桁) → "YYYY-MM"。不正なら null */
export function normalizeYearMonth(text: string): string | null {
  const m = /^(\d{4})(0[1-9]|1[0-2])$/.exec(text.trim());
  return m ? `${m[1]}-${m[2]}` : null;
}

/**
 * JAN 採番年月の入力欄。
 * 数字6桁 (例: 202608) の直接入力を基本に、📅 ボタンでカレンダー (月ピッカー) からも選べる。
 * サーバーへは hidden input (name 指定時) か onValueChange で "YYYY-MM" に正規化して渡す。
 */
export function JanMonthInput({
  name,
  defaultValue,
  onValueChange,
}: {
  /** フォーム送信用の hidden input 名 (正規化した YYYY-MM が入る) */
  name?: string;
  /** 初期値 (YYYYMM の6桁) */
  defaultValue: string;
  /** 値が変わったとき。正規化できた場合は "YYYY-MM"、不正なら null */
  onValueChange?: (value: string | null) => void;
}) {
  const [text, setText] = useState(defaultValue);
  const monthRef = useRef<HTMLInputElement | null>(null);
  const normalized = normalizeYearMonth(text);

  const update = (next: string) => {
    setText(next);
    onValueChange?.(normalizeYearMonth(next));
  };

  return (
    <span className="relative inline-flex items-center gap-1">
      <input
        inputMode="numeric"
        maxLength={6}
        value={text}
        onChange={(event) => update(event.target.value.replace(/\D/g, ""))}
        placeholder="202608"
        aria-label="採番年月 (数字6桁)"
        className={`tabular w-24 rounded-lg border px-2 py-1 text-right text-sm outline-none ${
          text && !normalized
            ? "border-rose-400 focus:border-rose-500"
            : "border-ink-200 focus:border-ink-400"
        }`}
      />
      {name && <input type="hidden" name={name} value={normalized ?? text} />}
      <button
        type="button"
        aria-label="カレンダーから年月を選択"
        title="カレンダーから選択"
        onClick={() => {
          try {
            monthRef.current?.showPicker();
          } catch {
            // showPicker 非対応ブラウザでは数字入力のみ
          }
        }}
        className="rounded-lg border border-ink-200 px-2 py-1 text-sm hover:bg-ink-50"
      >
        📅
      </button>
      {/* カレンダー用の月ピッカー。見えないが描画はされている必要がある (showPicker の制約) */}
      <input
        ref={monthRef}
        type="month"
        tabIndex={-1}
        aria-hidden
        value={normalized ?? ""}
        onChange={(event) => {
          const value = event.target.value; // "YYYY-MM"
          if (value) update(value.replaceAll("-", ""));
        }}
        className="pointer-events-none absolute bottom-0 left-0 h-px w-px opacity-0"
      />
    </span>
  );
}
