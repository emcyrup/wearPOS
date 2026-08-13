import type { Metadata } from "next";

import { LiffRedirect } from "@/components/liff-redirect";
import { liffConfig } from "@/lib/line";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "wearPOS",
  robots: { index: false, follow: false },
};

/**
 * リッチメニューの遷移先 (LIFF エンドポイント URL)。
 * LINE Developers の LIFF アプリにはこの URL を登録する。
 */
export default function LiffPage() {
  const { liffId } = liffConfig();

  if (!liffId) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-6 text-center">
        <p className="text-sm text-ink-500">
          LIFF が未設定です。環境変数 LIFF_ID / LIFF_CHANNEL_ID を設定してください。
        </p>
      </div>
    );
  }

  return <LiffRedirect liffId={liffId} />;
}
