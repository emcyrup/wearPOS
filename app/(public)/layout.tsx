/**
 * サイドバーなしの公開画面レイアウト。
 * レジ (店頭端末)・会員証・登録フォーム・ポイント・LIFF が対象。
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <main className="px-5 py-6">{children}</main>;
}
