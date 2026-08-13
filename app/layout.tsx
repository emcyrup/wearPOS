import type { Metadata } from "next";
import Link from "next/link";

import { NavLinks } from "@/components/nav-links";
import { canUseFeature, FEATURES, getSessionUser } from "@/lib/auth";
import { logout } from "@/app/login/actions";
import "./globals.css";

export const metadata: Metadata = {
  title: "wearPOS — アパレル顧客管理 / POS連携",
  description: "カラー×サイズSKU・シーズン管理を軸にした、アパレル向けの顧客管理とPOSレジ連携アプリ",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();

  // 未ログイン (=/login 表示中) はサイドバーなしで描画する
  if (!user) {
    return (
      <html lang="ja">
        <body className="min-h-full">
          <main className="px-5 py-6">{children}</main>
        </body>
      </html>
    );
  }

  const navItems = FEATURES.filter((feature) => canUseFeature(user, feature.key)).map(
    (feature) => ({
      href: feature.path,
      label: feature.label,
      exact: feature.path === "/",
      // レジは会計中に他画面へ移動しないよう別タブで開く
      newTab: feature.key === "register",
    }),
  );

  return (
    <html lang="ja">
      <body className="min-h-full">
        <div className="flex min-h-screen flex-col lg:flex-row">
          <aside className="shrink-0 border-b border-ink-200 bg-white lg:flex lg:w-56 lg:flex-col lg:border-r lg:border-b-0">
            <div className="flex items-center justify-between gap-2 px-5 py-4">
              <Link href={navItems[0]?.href ?? "/"} className="text-base font-semibold tracking-tight text-ink-900">
                wear<span className="text-accent">POS</span>
              </Link>
              {/* モバイル用のユーザー表示とログアウト */}
              <span className="flex items-center gap-2 text-xs text-ink-400 lg:hidden">
                {user.name}
                {user.uid && (
                  <form action={logout}>
                    <button type="submit" className="underline underline-offset-2 hover:text-ink-600">
                      ログアウト
                    </button>
                  </form>
                )}
              </span>
            </div>
            <NavLinks items={navItems} />
            <div className="hidden border-t border-ink-100 px-5 py-3 lg:mt-auto lg:block">
              <p className="truncate text-xs font-medium text-ink-600">{user.name}</p>
              <p className="mt-0.5 text-[11px] text-ink-400">
                {user.role === "ADMIN" ? "管理者" : "スタッフ"}
              </p>
              {user.uid && (
                <form action={logout} className="mt-2">
                  <button
                    type="submit"
                    className="text-xs text-ink-400 underline-offset-2 hover:text-ink-600 hover:underline"
                  >
                    ログアウト
                  </button>
                </form>
              )}
            </div>
          </aside>
          <main className="flex-1 px-5 py-6 lg:px-8 lg:py-8">
            <div className="mx-auto max-w-6xl">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
