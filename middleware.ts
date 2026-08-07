import { NextResponse, type NextRequest } from "next/server";

import { isAuthDisabled, SESSION_COOKIE, verifySession } from "@/lib/session";

/**
 * 認証と機能制限。
 * - 未ログインは /login へ (API は 401)
 * - STAFF ロールは許可された機能のパスにしかアクセスできない
 * - POS 連携 API (X-API-Key 認証) と LINE Webhook は対象外
 */

/** パスの先頭 → 機能キー */
const PATH_FEATURES: [prefix: string, feature: string][] = [
  ["/register", "register"],
  ["/products", "products"],
  ["/inventory", "inventory"],
  ["/customers", "customers"],
  ["/sales", "sales"],
  ["/scan", "scan"],
  ["/settings", "settings"],
  ["/api/insights", "dashboard"],
];

const FEATURE_PATHS: Record<string, string> = {
  dashboard: "/",
  register: "/register",
  products: "/products",
  inventory: "/inventory",
  customers: "/customers",
  sales: "/sales",
  scan: "/scan",
  settings: "/settings",
};

function featureForPath(pathname: string): string | null {
  if (pathname === "/") return "dashboard";
  for (const [prefix, feature] of PATH_FEATURES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return feature;
  }
  return null;
}

export async function middleware(request: NextRequest) {
  if (isAuthDisabled()) return NextResponse.next();

  const { pathname } = request.nextUrl;
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === "/login") {
    // ログイン済みならトップへ
    if (session) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
    }
    const login = new URL("/login", request.url);
    return NextResponse.redirect(login);
  }

  // 機能制限 (ADMIN は全機能)
  if (session.role !== "ADMIN") {
    const feature = featureForPath(pathname);
    if (feature && !session.features.includes(feature)) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "この機能を使う権限がありません" }, { status: 403 });
      }
      // 使える最初の機能のページへ逃がす (無限リダイレクトを避ける)
      const fallback = session.features.map((f) => FEATURE_PATHS[f]).find(Boolean) ?? "/login";
      if (fallback !== pathname) {
        return NextResponse.redirect(new URL(fallback, request.url));
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  // 静的ファイル・POS 連携 API・LINE Webhook・ヘルスチェック・会員証ページは対象外
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/pos|api/line|api/health|api/reminders|card/|.*\\.(?:png|jpg|svg|ico|webmanifest)).*)",
  ],
};
