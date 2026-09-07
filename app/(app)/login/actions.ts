"use server";

import { redirect } from "next/navigation";

import {
  clearSession,
  DEFAULT_STAFF_FEATURES,
  establishSession,
  hashPassword,
  hasAnyUser,
  homePathFor,
  verifyPassword,
} from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SIGNING_KEY_MISSING_MESSAGE } from "@/lib/session";
import { getSignupPolicy, verifySignupCode } from "@/lib/signup-policy";
import { ensureDefaultStore } from "@/lib/stores";

export type LoginState = { error: string };

/**
 * セッションの発行。署名鍵 (AUTH_SECRET) が無いと発行できないため、
 * その場合は 500 にせずログイン画面のエラーとして返す。
 */
async function startSession(user: Parameters<typeof establishSession>[0]): Promise<LoginState | null> {
  try {
    await establishSession(user);
    return null;
  } catch (error) {
    if (error instanceof Error && error.message === SIGNING_KEY_MISSING_MESSAGE) {
      return { error: error.message };
    }
    throw error;
  }
}


/** 何回続けて失敗したらロックするか / どれだけ止めるか */
const MAX_FAILED_LOGINS = 8;
const LOCK_MINUTES = 15;

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!username || !password) {
    return { error: "ユーザー名とパスワードを入力してください" };
  }

  const user = await prisma.appUser.findUnique({ where: { username } });

  // 総当たり対策。一定回数続けて失敗したら、しばらく受け付けない
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000));
    return {
      error: `ログインの失敗が続いたため、一時的に停止しています。${minutes}分ほどおいてからお試しください`,
    };
  }

  if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
    if (user) {
      // ユーザーの有無を答えとして返さないよう、記録だけ残して同じ文言を返す
      const failed = user.failedLogins + 1;
      await prisma.appUser.update({
        where: { id: user.id },
        data: {
          failedLogins: failed,
          lockedUntil:
            failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        },
      });
    }
    return { error: "ユーザー名またはパスワードが違います" };
  }

  if (user.failedLogins > 0 || user.lockedUntil) {
    await prisma.appUser.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null },
    });
  }

  const failed = await startSession(user);
  if (failed) return failed;
  redirect(
    homePathFor({ role: user.role === "ADMIN" ? "ADMIN" : "STAFF", features: user.features }),
  );
}

/**
 * 初期セットアップ: ユーザーが1人もいないときだけ、管理者アカウントを作成できる。
 */
export async function createInitialAdmin(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  if (await hasAnyUser()) {
    return { error: "すでにユーザーが登録されています。ログインしてください" };
  }

  const username = String(formData.get("username") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim() || username;
  const password = String(formData.get("password") ?? "");
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    return { error: "ユーザー名は3〜32文字の半角英数字で入力してください" };
  }
  if (password.length < 8) {
    return { error: "パスワードは8文字以上にしてください" };
  }

  const user = await prisma.appUser.create({
    data: {
      username,
      displayName,
      passwordHash: hashPassword(password),
      role: "ADMIN",
    },
  });

  // 伝票・在庫は店舗にひも付くため、まっさらな環境では既定の店舗を用意しておく
  // (店舗名は 設定 → 店舗 から変更できる)
  await ensureDefaultStore();

  const failed = await startSession(user);
  if (failed) return failed;
  redirect("/");
}

/**
 * ログイン画面からの新規ユーザー作成 (セルフサインアップ)。
 *
 * 作成されるのは常に **スタッフ権限 + 既定機能 (レジ / 商品 / 在庫)** で、
 * 顧客情報・取引履歴・設定にはアクセスできない。権限を広げるのは管理者の操作。
 * 設定画面の方針が「停止」なら作成させず、「合言葉が必要」なら合言葉を検証する。
 */
export async function signUp(_prev: LoginState, formData: FormData): Promise<LoginState> {
  // ユーザーが1人もいなければ、これは初期セットアップ (管理者作成) として扱う
  if (!(await hasAnyUser())) {
    return createInitialAdmin(_prev, formData);
  }

  const policy = await getSignupPolicy();
  if (policy.mode === "OFF") {
    return { error: "新規ユーザーの作成は停止されています。管理者に追加を依頼してください" };
  }

  const username = String(formData.get("username") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim() || username;
  const password = String(formData.get("password") ?? "");
  const passwordConfirm = String(formData.get("passwordConfirm") ?? "");
  const code = String(formData.get("signupCode") ?? "").trim();

  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    return { error: "ユーザー名は3〜32文字の半角英数字で入力してください" };
  }
  if (displayName.length > 50) {
    return { error: "表示名は50文字以内で入力してください" };
  }
  if (password.length < 8) {
    return { error: "パスワードは8文字以上にしてください" };
  }
  if (password !== passwordConfirm) {
    return { error: "パスワードが一致しません" };
  }

  if (policy.mode === "CODE") {
    if (!policy.hasCode) {
      return { error: "合言葉が未設定のため作成できません。管理者にお問い合わせください" };
    }
    if (!code || !(await verifySignupCode(code))) {
      return { error: "合言葉が違います" };
    }
  }

  const exists = await prisma.appUser.findUnique({ where: { username } });
  if (exists) {
    return { error: `ユーザー名「${username}」は既に使われています` };
  }

  const user = await prisma.appUser.create({
    data: {
      username,
      displayName,
      passwordHash: hashPassword(password),
      role: "STAFF",
      features: DEFAULT_STAFF_FEATURES,
    },
  });

  const failed = await startSession(user);
  if (failed) return failed;
  redirect(homePathFor({ role: "STAFF", features: user.features }));
}

export async function logout(): Promise<void> {
  await clearSession();
  redirect("/login");
}
