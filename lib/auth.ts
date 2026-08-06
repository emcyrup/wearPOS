import { cookies } from "next/headers";

import { prisma } from "@/lib/db";
import {
  isAuthDisabled,
  SESSION_COOKIE,
  signSession,
  verifySession,
  type SessionPayload,
} from "@/lib/session";

/**
 * 画面単位の機能キー。
 * STAFF ロールのユーザーは AppUser.features に含まれる機能だけ使える。
 */
export const FEATURES = [
  { key: "dashboard", label: "ダッシュボード", path: "/" },
  { key: "register", label: "レジ", path: "/register" },
  { key: "products", label: "商品 / SKU", path: "/products" },
  { key: "inventory", label: "在庫", path: "/inventory" },
  { key: "customers", label: "顧客 (CRM)", path: "/customers" },
  { key: "sales", label: "取引履歴", path: "/sales" },
  { key: "scan", label: "スキャン", path: "/scan" },
  { key: "settings", label: "設定 / 連携", path: "/settings" },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];

export const FEATURE_KEYS = FEATURES.map((f) => f.key);

/** 新規スタッフに付ける既定の機能 (レジ・在庫まわりのみ) */
export const DEFAULT_STAFF_FEATURES: FeatureKey[] = ["register", "scan", "inventory"];

export function canUseFeature(
  user: Pick<SessionPayload, "role" | "features">,
  feature: FeatureKey,
): boolean {
  return user.role === "ADMIN" || user.features.includes(feature);
}

/** ログイン後に最初に表示するパス */
export function homePathFor(user: Pick<SessionPayload, "role" | "features">): string {
  if (user.role === "ADMIN" || user.features.includes("dashboard")) return "/";
  const first = FEATURES.find((f) => user.features.includes(f.key));
  return first?.path ?? "/";
}

// ---- パスワード ----

export { hashPassword, verifyPassword } from "@/lib/password";

// ---- セッション ----

/** 認証無効時に使う擬似ユーザー (静的デモや初期セットアップ前の表示用) */
export const PSEUDO_ADMIN: SessionPayload = {
  uid: "",
  username: "demo",
  name: "デモユーザー",
  role: "ADMIN",
  features: [],
  exp: Number.MAX_SAFE_INTEGER,
};

/** 現在のセッションユーザーを返す。未ログインなら null (認証無効時は擬似管理者) */
export async function getSessionUser(): Promise<SessionPayload | null> {
  if (isAuthDisabled()) return PSEUDO_ADMIN;
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

/** ログイン成功時にセッション Cookie を発行する */
export async function establishSession(user: {
  id: string;
  username: string;
  displayName: string;
  role: string;
  features: string[];
}): Promise<void> {
  const token = await signSession({
    uid: user.id,
    username: user.username,
    name: user.displayName,
    role: user.role === "ADMIN" ? "ADMIN" : "STAFF",
    features: user.features,
  });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Server Action 内での管理者チェック。管理者でなければ null */
export async function requireAdmin(): Promise<SessionPayload | null> {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return null;
  return user;
}

/** 登録済みユーザーがいるか (初期セットアップ判定) */
export async function hasAnyUser(): Promise<boolean> {
  return (await prisma.appUser.count()) > 0;
}
