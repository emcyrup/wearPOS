"use client";

import { useEffect, useState } from "react";

type LiffSdk = {
  init: (config: { liffId: string }) => Promise<void>;
  isLoggedIn: () => boolean;
  login: (options?: { redirectUri?: string }) => void;
  getIDToken: () => string | null;
  isInClient: () => boolean;
  closeWindow: () => void;
};

declare global {
  interface Window {
    liff?: LiffSdk;
  }
}

/** タップされたメニューに対応する、トークで送ってもらうキーワード */
const KEYWORD_BY_DEST: Record<string, string> = {
  signup: "会員登録",
  card: "会員証",
  points: "ポイント",
};

/**
 * リッチメニューから開かれる LIFF の入り口。
 * LINE が本人を自動認証するので、ID トークンをサーバーで検証して
 * 会員登録フォーム / 会員証 / ポイントの本人専用ページへ即リダイレクトする。
 *
 * 本人確認できないとき (LIFF の同意でプロフィール提供に同意していない等) は
 * 行き止まりにせず、トークにキーワードを送る方法を案内する。
 * キーワード応答は Webhook の署名検証を通るため、確実かつ安全に同じ画面へ辿り着ける。
 */
export function LiffRedirect({ liffId }: { liffId: string }) {
  const [failure, setFailure] = useState<{ detail: string; keyword: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const dest =
      new URLSearchParams(window.location.search).get("dest") ?? "card";
    const keyword = KEYWORD_BY_DEST[dest] ?? "会員登録";
    const fail = (detail: string) => {
      if (!cancelled) setFailure({ detail, keyword });
    };

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
        if (!liff) {
          fail("LIFF SDK を初期化できませんでした");
          return;
        }

        await liff.init({ liffId });
        if (!liff.isLoggedIn()) {
          liff.login({ redirectUri: window.location.href });
          return;
        }

        // 同意でプロフィール提供に同意していない場合などは null になる
        const idToken = liff.getIDToken();
        if (!idToken) {
          fail("本人確認情報を取得できませんでした (プロフィール提供の同意が必要です)");
          return;
        }

        const response = await fetch("/api/liff/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken, dest }),
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null;
          fail(data?.error ?? `遷移先の取得に失敗しました (${response.status})`);
          return;
        }
        const { url } = (await response.json()) as { url: string };
        if (!cancelled) window.location.replace(url);
      } catch (err) {
        fail(err instanceof Error ? err.message : "読み込みに失敗しました");
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [liffId]);

  if (failure) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-sm items-center justify-center px-6">
        <div className="w-full rounded-xl border border-ink-200 bg-white p-6 text-center">
          <p className="text-sm font-medium text-ink-900">この画面を開けませんでした</p>
          <p className="mt-3 text-sm leading-relaxed text-ink-600">
            お手数ですが、LINE のトークに
            <span className="mx-1 rounded bg-accent-soft px-1.5 py-0.5 font-semibold text-accent">
              {failure.keyword}
            </span>
            と送信してください。すぐにご案内をお送りします。
          </p>
          <button
            type="button"
            onClick={() => {
              // LINE アプリ内ならトークへ戻す
              if (window.liff?.isInClient?.()) window.liff.closeWindow();
              else window.history.back();
            }}
            className="mt-5 w-full rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink-800"
          >
            トークに戻る
          </button>
          <p className="mt-4 text-[11px] leading-relaxed text-ink-400">{failure.detail}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6 text-center">
      <div>
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-ink-200 border-t-ink-900" />
        <p className="mt-3 text-sm text-ink-500">開いています...</p>
      </div>
    </div>
  );
}
