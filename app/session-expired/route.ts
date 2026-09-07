import { NextResponse } from "next/server";

import { SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * 使えなくなったセッションを片付けてログイン画面へ戻す。
 *
 * 署名としては正しいトークンでも、ユーザーが無効化・削除されていれば通してはいけない。
 * その判定は DB を見る必要があり middleware (Edge) ではできないため、
 * 画面側で気づいたときにここへ寄せて Cookie を消す。
 */
export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
