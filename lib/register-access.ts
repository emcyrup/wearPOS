import { cookies } from "next/headers";

import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { signRegisterToken, verifyRegisterToken } from "@/lib/session";

/**
 * レジ端末のアクセス制御。
 *
 * レジ (/register) は店頭端末でログインなしに使えるようにしているが、
 * URL が外部から届く以上、そのままでは会員検索や会計をだれでも実行できてしまう。
 * そこで「この端末はお店のものだ」と一度だけ確認し、その結果を端末の Cookie に持たせる。
 *
 * 通し方は2つ:
 * - **ログイン済み** (レジ機能を使える権限) ならそのまま使える
 * - **レジ端末コード** を入力して端末を認可すると、以降ログインなしで使える
 *
 * レジ端末コードが未設定のあいだは、ログイン済みの人しか使えない (安全側)。
 */

const REGISTER_CODE_KEY = "register.codeHash";

/** 認可した端末をどれだけ覚えておくか */
export const REGISTER_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 90; // 90日
export const REGISTER_COOKIE = "wearpos_register";

/** レジ端末コードが設定されているか (値そのものは返さない) */
export async function hasRegisterCode(): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: REGISTER_CODE_KEY } });
  return Boolean(row?.value);
}

/** レジ端末コードを設定する。空文字を渡すと解除 (ログイン必須に戻る) */
export async function saveRegisterCode(code: string): Promise<void> {
  const trimmed = code.trim();
  if (!trimmed) {
    await prisma.appSetting.deleteMany({ where: { key: REGISTER_CODE_KEY } });
    return;
  }
  const value = hashPassword(trimmed);
  await prisma.appSetting.upsert({
    where: { key: REGISTER_CODE_KEY },
    update: { value },
    create: { key: REGISTER_CODE_KEY, value },
  });
}

/** 入力されたコードが正しいか */
export async function verifyRegisterCode(code: string): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: REGISTER_CODE_KEY } });
  if (!row?.value) return false;
  return verifyPassword(code.trim(), row.value);
}

/** 認可済みの端末として Cookie を発行する */
export async function grantRegisterAccess(): Promise<void> {
  const store = await cookies();
  store.set(REGISTER_COOKIE, await signRegisterToken(REGISTER_TOKEN_TTL_SECONDS), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: REGISTER_TOKEN_TTL_SECONDS,
  });
}

/** 端末の認可を取り消す */
export async function revokeRegisterAccess(): Promise<void> {
  const store = await cookies();
  store.delete(REGISTER_COOKIE);
}

/**
 * いまレジを使ってよいか。
 * ログイン済み (レジ機能あり) か、認可済みの端末なら true。
 */
export async function hasRegisterAccess(): Promise<boolean> {
  const user = await getSessionUser();
  if (user && (user.role === "ADMIN" || user.features.includes("register"))) return true;

  const store = await cookies();
  return verifyRegisterToken(store.get(REGISTER_COOKIE)?.value);
}

/** サーバーアクションの入口で使うガード。未認可なら理由つきで false */
export async function requireRegisterAccess(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  if (await hasRegisterAccess()) return { ok: true };
  return {
    ok: false,
    error: "このレジ端末は認可されていません。レジ端末コードを入力するか、ログインしてください",
  };
}
