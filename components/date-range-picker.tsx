"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * カレンダーでの期間指定。
 * 適用すると /?from=YYYY-MM-DD&to=YYYY-MM-DD に遷移する。
 */
export function DateRangePicker({
  from,
  to,
  active,
}: {
  from: string;
  to: string;
  active: boolean;
}) {
  const router = useRouter();
  const [fromValue, setFromValue] = useState(from);
  const [toValue, setToValue] = useState(to);
  const invalid = Boolean(fromValue && toValue && fromValue > toValue);

  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!fromValue || !toValue || invalid) return;
        router.push(`/?from=${fromValue}&to=${toValue}`);
      }}
    >
      <input
        type="date"
        value={fromValue}
        onChange={(event) => setFromValue(event.target.value)}
        aria-label="開始日"
        className={`tabular rounded-lg border bg-white px-2 py-1 text-sm outline-none focus:border-ink-400 ${
          active ? "border-ink-900" : "border-ink-200"
        }`}
      />
      <span className="text-xs text-ink-400">〜</span>
      <input
        type="date"
        value={toValue}
        onChange={(event) => setToValue(event.target.value)}
        aria-label="終了日"
        className={`tabular rounded-lg border bg-white px-2 py-1 text-sm outline-none focus:border-ink-400 ${
          active ? "border-ink-900" : "border-ink-200"
        }`}
      />
      <button
        type="submit"
        disabled={invalid}
        title={invalid ? "開始日は終了日より前にしてください" : undefined}
        className="rounded-lg bg-ink-900 px-3 py-1 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-40"
      >
        適用
      </button>
    </form>
  );
}
