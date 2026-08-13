import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "wearPOS — アパレル顧客管理 / POS連携",
  description: "カラー×サイズSKU・シーズン管理を軸にした、アパレル向けの顧客管理とPOSレジ連携アプリ",
};

/**
 * ルートレイアウトは骨組みだけ。
 * サイドバー付きの管理画面は app/(app)/layout.tsx、
 * レジ・会員証などサイドバーなしの画面は app/(public)/layout.tsx が担う。
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
