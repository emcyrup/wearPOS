"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; exact?: boolean };

export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:px-3">
      {items.map((item) => {
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
