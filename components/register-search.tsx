"use client";

import { MULTI_STORE } from "@/lib/config";
import { useEffect, useRef, useState, useTransition } from "react";

import {
  searchMembers,
  searchProducts,
  type MemberSearchResult,
  type ProductSearchResult,
} from "@/app/(public)/register/actions";

const yen = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

const RANK_LABEL: Record<string, string> = {
  REGULAR: "レギュラー",
  SILVER: "シルバー",
  GOLD: "ゴールド",
  PLATINUM: "プラチナ",
};

/** 検索モーダルの外枠 (商品・会員で共通) */
function SearchModal({
  title,
  placeholder,
  hint,
  onClose,
  children,
  query,
  onQueryChange,
  onSubmit,
  searching,
}: {
  title: string;
  placeholder: string;
  hint: string;
  onClose: () => void;
  children: React.ReactNode;
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
  searching: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink-900/60 p-4 pt-[8vh]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-ink-800">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-ink-400 hover:bg-ink-50 hover:text-ink-600"
          >
            閉じる
          </button>
        </div>

        <form
          className="flex gap-2 border-b border-ink-100 px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={placeholder}
            className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-400"
          />
          <button
            type="submit"
            disabled={searching}
            className="shrink-0 rounded-lg bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-50"
          >
            {searching ? "検索中..." : "検索"}
          </button>
        </form>

        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        <p className="border-t border-ink-100 px-4 py-2 text-xs text-ink-400">{hint}</p>
      </div>
    </div>
  );
}

/** 商品検索 (バーコードが読めないとき用)。選ぶとカートに追加される */
export function ProductSearchModal({
  storeCode,
  onSelect,
  onClose,
}: {
  storeCode: string;
  onSelect: (sku: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductSearchResult[] | null>(null);
  const [searching, startSearch] = useTransition();

  const run = () =>
    startSearch(async () => {
      setResults(await searchProducts(query, storeCode));
    });

  return (
    <SearchModal
      title="商品を検索してカートに追加"
      placeholder="商品名・品番・SKU・カラー (例: コート / 26SS-SH-001 / ブラック)"
      hint="バーコードが読み取れないときにご利用ください。選ぶとカートに1点追加されます"
      query={query}
      onQueryChange={setQuery}
      onSubmit={run}
      searching={searching}
      onClose={onClose}
    >
      {results === null ? (
        <p className="px-4 py-10 text-center text-sm text-ink-400">
          商品名や品番を入力して検索してください
        </p>
      ) : results.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-ink-400">
          該当する商品が見つかりませんでした
        </p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {results.map((item) => (
            <li key={item.sku}>
              <button
                type="button"
                onClick={() => onSelect(item.sku)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent-soft/40"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-800">
                    {item.productName}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-ink-400">
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-ink-200"
                      style={{ backgroundColor: item.colorHex ?? "transparent" }}
                    />
                    <span className="truncate">
                      {item.colorName} / {item.sizeName} · {item.sku}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="tabular block text-sm font-medium text-ink-900">
                    {yen.format(item.price)}
                  </span>
                  <span
                    className={`tabular block text-xs ${
                      item.stock > 0 ? "text-ink-400" : "text-rose-700"
                    }`}
                  >
                    {item.stock > 0 ? `在庫 ${item.stock}` : "在庫なし"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </SearchModal>
  );
}

/** 会員検索 (会員証・会員番号が分からないとき用)。選ぶと会計に紐付く */
export function MemberSearchModal({
  onSelect,
  onClose,
}: {
  onSelect: (memberCode: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberSearchResult[] | null>(null);
  const [searching, startSearch] = useTransition();

  const run = () =>
    startSearch(async () => {
      setResults(await searchMembers(query));
    });

  return (
    <SearchModal
      title="会員を検索"
      placeholder="氏名・カナ・電話番号・会員番号 (例: 佐藤 / サトウ / 090)"
      hint="会員証やお名刺がないときにご利用ください。選ぶとこの会計に紐付きます"
      query={query}
      onQueryChange={setQuery}
      onSubmit={run}
      searching={searching}
      onClose={onClose}
    >
      {results === null ? (
        <p className="px-4 py-10 text-center text-sm text-ink-400">
          お名前や電話番号を入力して検索してください
        </p>
      ) : results.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-ink-400">
          該当する会員が見つかりませんでした
        </p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {results.map((member) => (
            <li key={member.memberCode}>
              <button
                type="button"
                onClick={() => onSelect(member.memberCode)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent-soft/40"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-800">
                    {member.name} 様
                  </span>
                  <span className="tabular block truncate text-xs text-ink-400">
                    {member.memberCode}
                    {member.nameKana && ` · ${member.nameKana}`}
                    {member.phone && ` · ${member.phone}`}
                    {MULTI_STORE && member.storeName && ` · ${member.storeName}`}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-xs text-ink-500">
                    {RANK_LABEL[member.rank] ?? member.rank}
                  </span>
                  <span className="tabular block text-xs text-ink-400">
                    {member.points.toLocaleString("ja-JP")} pt
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </SearchModal>
  );
}
