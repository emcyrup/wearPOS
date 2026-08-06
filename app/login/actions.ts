"use server";

import { redirect } from "next/navigation";

import {
  clearSession,
  establishSession,
  hashPassword,
  hasAnyUser,
  homePathFor,
  verifyPassword,
} from "@/lib/auth";
import { prisma } from "@/lib/db";

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

export async function logout(): Promise<void> {
  await clearSession();
  redirect("/login");
}
