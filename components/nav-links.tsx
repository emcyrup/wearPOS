"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "ダッシュボード", exact: true },
  { href: "/products", label: "商品 / SKU" },
  { href: "/inventory", label: "在庫" },
  { href: "/customers", label: "顧客 (CRM)" },
  { href: "/sales", label: "取引履歴" },
  { href: "/settings", label: "設定 / 連携" },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:px-3">
      {NAV.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              "rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              active ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-100",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
