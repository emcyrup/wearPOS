"use server";

import { headers } from "next/headers";

import { requireAdmin } from "@/lib/auth";
import { setupDefaultRichMenu } from "@/lib/line";

export type RichMenuResult = {
  ok: boolean;
  richMenuId?: string;
  /** liff: タップで直接画面遷移 / message: キーワード送信方式 */
  mode?: "liff" | "message";
  error?: string;
};

/**
 * リッチメニュー (会員登録 / 会員証 / ポイント) を作成して全ユーザーに適用する。
 * 画像は public/line-richmenu.png を自オリジンから取得して LINE にアップロードする。
 */
export async function applyRichMenu(): Promise<RichMenuResult> {
  if (!(await requireAdmin())) {
    return { ok: false, error: "管理者のみ実行できます" };
  }

  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const proto = headerStore.get("x-forwarded-proto") ?? "https";
  const origin = process.env.APP_URL ?? (host ? `${proto}://${host}` : null);
  if (!origin) {
    return { ok: false, error: "アプリの URL を特定できませんでした (APP_URL を設定してください)" };
  }

  const imageRes = await fetch(`${origin}/line-richmenu.png`);
  if (!imageRes.ok) {
    return { ok: false, error: `メニュー画像を取得できませんでした (${imageRes.status})` };
  }
  const image = new Uint8Array(await imageRes.arrayBuffer());

  return setupDefaultRichMenu(image);
}
