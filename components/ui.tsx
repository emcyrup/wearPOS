import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";

export function Card({
  title,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={clsx(
        // min-w-0: グリッド内でテーブル等の中身に引っ張られて親からはみ出さないようにする
        "min-w-0 rounded-xl border border-ink-200 bg-white shadow-[0_1px_2px_rgba(22,22,28,0.04)]",
        className,
      )}
    >
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-ink-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-ink-800">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  sub,
  trend,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  /** 前期間比 (0.12 = +12%) */
  trend?: number | null;
}) {
  return (
    // スマートフォンでは2枚並びになるため、パディングと数値を一段小さくする
    <div className="min-w-0 rounded-xl border border-ink-200 bg-white px-3.5 py-3 sm:px-5 sm:py-4">
      <p className="truncate text-xs font-medium text-ink-400">{label}</p>
      <p className="tabular mt-1.5 text-lg font-semibold tracking-tight text-ink-900 sm:text-2xl">
        {value}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {trend !== undefined && trend !== null && (
          <span
            className={clsx(
              "tabular rounded-full px-1.5 py-0.5 font-medium",
              trend >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700",
            )}
          >
            {trend >= 0 ? "▲" : "▼"} {Math.abs(trend * 100).toFixed(1)}%
          </span>
        )}
        {sub && <span className="text-ink-400">{sub}</span>}
      </div>
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "success" | "warning" | "danger" | "info";
}) {
  const tones = {
    neutral: "bg-ink-100 text-ink-600",
    accent: "bg-accent-soft text-accent",
    success: "bg-emerald-50 text-emerald-700",
    warning: "bg-amber-50 text-amber-700",
    danger: "bg-rose-50 text-rose-700",
    info: "bg-sky-50 text-sky-700",
  } as const;

  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-ink-200 px-6 py-10 text-center">
      <p className="text-sm text-ink-600">{message}</p>
      {hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
    </div>
  );
}

/** 列見出し。文字列だけ渡すと左寄せ、右寄せにしたい数値列は {label, align:"right"} で指定する */
export type TableColumn = ReactNode | { label: ReactNode; align?: "left" | "right" | "center" };

const alignClass = { left: "text-left", right: "text-right", center: "text-center" } as const;

/**
 * 一覧の表。
 * ヘッダーは薄い背景で固定表示し、行はゼブラ + ホバーで追いやすくする。
 * 数値セル側の右寄せは各ページで `text-right` を付ける。
 */
export function Table({
  head,
  children,
  minWidth = 520,
}: {
  head: TableColumn[];
  children: ReactNode;
  /** 横スクロールが始まる幅 (列が多い表は広げる) */
  minWidth?: number;
}) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table
        style={{ minWidth }}
        className={clsx(
          "w-full border-collapse text-sm",
          // 行の区切り・ゼブラ・ホバーは行側に個別指定しなくても効くようにする
          "[&_tbody_tr]:border-b [&_tbody_tr]:border-ink-100 [&_tbody_tr:last-child]:border-0",
          "[&_tbody_tr:nth-child(even)]:bg-ink-50/40 [&_tbody_tr:hover]:bg-accent-soft/40",
          "[&_tbody_tr]:transition-colors",
        )}
      >
        <thead className="sticky top-0 z-10">
          <tr className="bg-ink-50">
            {head.map((cell, i) => {
              const column =
                cell && typeof cell === "object" && "label" in cell
                  ? (cell as { label: ReactNode; align?: "left" | "right" | "center" })
                  : { label: cell as ReactNode, align: "left" as const };
              return (
                <th
                  key={i}
                  className={clsx(
                    "border-b border-ink-200 px-2 py-2.5 text-xs font-semibold whitespace-nowrap text-ink-500",
                    alignClass[column.align ?? "left"],
                  )}
                >
                  {column.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-400">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function LinkButton({
  href,
  children,
  variant = "secondary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
}) {
  return (
    <Link
      href={href}
      className={clsx(
        "inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
        variant === "primary"
          ? "bg-ink-900 text-white hover:bg-ink-800"
          : "border border-ink-200 bg-white text-ink-600 hover:bg-ink-50",
      )}
    >
      {children}
    </Link>
  );
}

/** 在庫数に応じた色分けセル */
export function StockCell({ quantity, safetyStock = 0 }: { quantity: number; safetyStock?: number }) {
  const tone =
    quantity <= 0
      ? "bg-rose-50 text-rose-700"
      : safetyStock > 0 && quantity <= safetyStock
        ? "bg-amber-50 text-amber-700"
        : "text-ink-800";
  return (
    <span className={clsx("tabular inline-block min-w-9 rounded px-1.5 py-0.5 text-center", tone)}>
      {quantity}
    </span>
  );
}

/**
 * 一覧のページ送り。
 * スマートフォンでは1画面に数百行を描画すると DOM が肥大して表示が遅くなるため、
 * 既定で 50 件ずつに区切る。
 */
export const PAGE_SIZE = 50;

export function Pagination({
  page,
  total,
  pageSize = PAGE_SIZE,
  basePath,
  params,
}: {
  page: number;
  total: number;
  pageSize?: number;
  basePath: string;
  /** 現在の絞り込み条件。ページ送りしても維持する */
  params: Record<string, string | undefined>;
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  const hrefFor = (target: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) query.set(key, value);
    }
    if (target > 1) query.set("page", String(target));
    const qs = query.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav className="mt-4 flex items-center justify-between gap-3 border-t border-ink-100 pt-3">
      <p className="tabular text-xs text-ink-400">
        {from}–{to} 件 / 全 {total.toLocaleString("ja-JP")} 件
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link
            href={hrefFor(page - 1)}
            className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50"
          >
            前へ
          </Link>
        ) : (
          <span className="rounded-lg border border-ink-100 px-3 py-1.5 text-sm text-ink-200">前へ</span>
        )}
        <span className="tabular text-xs text-ink-400">
          {page} / {lastPage}
        </span>
        {page < lastPage ? (
          <Link
            href={hrefFor(page + 1)}
            className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50"
          >
            次へ
          </Link>
        ) : (
          <span className="rounded-lg border border-ink-100 px-3 py-1.5 text-sm text-ink-200">次へ</span>
        )}
      </div>
    </nav>
  );
}
