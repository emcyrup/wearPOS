"use client";

import { useRouter } from "next/navigation";

/**
 * 行全体をクリックで遷移できるテーブル行。
 * 行内のリンクやボタンをクリックした場合はそちらを優先する。
 */
export function LinkRow({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  return (
    <tr
      onClick={(event) => {
        // 行内の個別リンク・ボタン・入力はそのまま動かす
        if ((event.target as HTMLElement).closest("a, button, input, select, label")) return;
        router.push(href);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target === event.currentTarget) router.push(href);
      }}
      tabIndex={0}
      aria-label="詳細を表示"
      className={`cursor-pointer ${className ?? ""}`}
    >
      {children}
    </tr>
  );
}
