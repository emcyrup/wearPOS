"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; exact?: boolean; newTab?: boolean };

/** レジタブの window.name。レジ側 (components/register.tsx) と一致させること */
export const REGISTER_WINDOW_NAME = "wearpos-register";

export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  /**
   * レジを別タブで開く。すでにレジのタブが開いていれば、
   * リロードせずそのタブをアクティブにする (会計中のカートを守る)。
   */
  const openRegisterTab = (event: React.MouseEvent, href: string) => {
    event.preventDefault();
    const win = window.open("", REGISTER_WINDOW_NAME);
    if (!win) return; // ポップアップブロック時は何もしない (target 付きリンクが下で効く)
    try {
      // 既存のレジタブなら遷移させずフォーカスのみ。新規 (about:blank) ならレジを読み込む
      if (!win.location.pathname.startsWith(href)) {
        win.location.href = href;
      }
    } catch {
      win.location.href = href;
    }
    win.focus();
  };

  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:px-3">
      {items.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            // 別タブ対象は名前付きウィンドウにし、既存タブの再利用を可能にする
            target={item.newTab ? REGISTER_WINDOW_NAME : undefined}
            onClick={item.newTab ? (event) => openRegisterTab(event, item.href) : undefined}
            className={clsx(
              "rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              active ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-100",
            )}
          >
            {item.label}
            {item.newTab && <span className="ml-1 text-[10px] opacity-60">↗</span>}
          </Link>
        );
      })}
    </nav>
  );
}
