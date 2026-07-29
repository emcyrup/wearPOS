import type { Metadata } from "next";
import Link from "next/link";

import { NavLinks } from "@/components/nav-links";
import "./globals.css";

export const metadata: Metadata = {
  title: "wearPOS — アパレル顧客管理 / POS連携",
  description: "カラー×サイズSKU・シーズン管理を軸にした、アパレル向けの顧客管理とPOSレジ連携アプリ",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-full">
        <div className="flex min-h-screen flex-col lg:flex-row">
          <aside className="shrink-0 border-b border-ink-200 bg-white lg:w-56 lg:border-r lg:border-b-0">
            <div className="flex items-center gap-2 px-5 py-4">
              <Link href="/" className="text-base font-semibold tracking-tight text-ink-900">
                wear<span className="text-accent">POS</span>
              </Link>
            </div>
            <NavLinks />
          </aside>
          <main className="flex-1 px-5 py-6 lg:px-8 lg:py-8">
            <div className="mx-auto max-w-6xl">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
