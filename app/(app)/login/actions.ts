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
import { getSignupPolicy, verifySignupCode } from "@/lib/signup-policy";

export type LoginState = { error: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!username || !password) {
    return { error: "ユーザー名とパスワードを入力してください" };
  }

  const user = await prisma.appUser.findUnique({ where: { username } });
  if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
    return { error: "ユーザー名またはパスワードが違います" };
  }

  await establishSession(user);
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

  await establishSession(user);
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

  await establishSession(user);
  redirect(homePathFor({ role: "STAFF", features: user.features }));
}

export async function logout(): Promise<void> {
  await clearSession();
  redirect("/login");
}
