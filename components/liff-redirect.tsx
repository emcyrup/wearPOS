"use client";

import { useEffect, useState } from "react";

type LiffSdk = {
  init: (config: { liffId: string }) => Promise<void>;
  isLoggedIn: () => boolean;
  login: (options?: { redirectUri?: string }) => void;
  getIDToken: () => string | null;
};

declare global {
  interface Window {
    liff?: LiffSdk;
  }
}

/**
 * リッチメニューから開かれる LIFF の入り口。
 * LINE が本人を自動認証するので、ID トークンをサーバーで検証して
 * 会員登録フォーム / 会員証 / ポイントの本人専用ページへ即リダイレクトする。
 */
export function LiffRedirect({ liffId }: { liffId: string }) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        // LIFF SDK を動的に読み込む
        if (!window.liff) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "https://static.line-scdn.net/liff/edge/2/sdk.js";
            script.onload = () => resolve();
            script.onerror = () => reject(new Error("LIFF SDK の読み込みに失敗しました"));
            document.head.appendChild(script);
          });
        }
        const liff = window.liff;
        if (!liff) throw new Error("LIFF SDK を初期化できませんでした");

        await liff.init({ liffId });
        if (!liff.isLoggedIn()) {
          liff.login({ redirectUri: window.location.href });
          return;
        }

        const idToken = liff.getIDToken();
        if (!idToken) throw new Error("本人確認情報を取得できませんでした");

        const dest = new URLSearchParams(window.location.search).get("dest") ?? "card";
        const response = await fetch("/api/liff/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken, dest }),
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error ?? "遷移先の取得に失敗しました");
        }
        const { url } = (await response.json()) as { url: string };
        if (!cancelled) window.location.replace(url);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "読み込みに失敗しました");
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [liffId]);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6 text-center">
      {error ? (
        <div>
          <p className="text-sm text-rose-700">{error}</p>
          <p className="mt-2 text-xs text-ink-400">
            LINE のトークからメニューを開き直してください
          </p>
        </div>
      ) : (
        <div>
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-ink-200 border-t-ink-900" />
          <p className="mt-3 text-sm text-ink-500">開いています...</p>
        </div>
      )}
    </div>
  );
}
