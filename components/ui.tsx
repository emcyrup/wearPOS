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
        "rounded-xl border border-ink-200 bg-white shadow-[0_1px_2px_rgba(22,22,28,0.04)]",
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
    <div className="rounded-xl border border-ink-200 bg-white px-5 py-4">
      <p className="text-xs font-medium text-ink-400">{label}</p>
      <p className="tabular mt-1.5 text-2xl font-semibold tracking-tight text-ink-900">{value}</p>
      <div className="mt-1 flex items-center gap-2 text-xs">
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

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink-200 text-left">
            {head.map((cell, i) => (
              <th key={i} className="px-2 py-2 text-xs font-medium text-ink-400 whitespace-nowrap">
                {cell}
              </th>
            ))}
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
