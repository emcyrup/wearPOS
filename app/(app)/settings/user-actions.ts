"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  FEATURE_KEYS,
  hashPassword,
  requireAdmin,
  type FeatureKey,
} from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSignupPolicy, saveSignupPolicy } from "@/lib/signup-policy";

export type UserActionState = { status: "idle" | "success" | "error"; message: string };

const featureListSchema = z
  .array(z.enum(FEATURE_KEYS as [FeatureKey, ...FeatureKey[]]))
  .max(FEATURE_KEYS.length);

const createUserSchema = z.object({
  username: z.string().regex(/^[a-zA-Z0-9_.-]{3,32}$/),
  displayName: z.string().min(1).max(50),
  password: z.string().min(8).max(100),
  role: z.enum(["ADMIN", "STAFF"]),
  features: featureListSchema,
});

export async function createUser(input: unknown): Promise<UserActionState> {
  if (!(await requireAdmin())) {
    return { status: "error", message: "管理者のみ実行できます" };
  }
  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: "入力内容を確認してください (ユーザー名は3〜32文字の半角英数字、パスワードは8文字以上)",
    };
  }

  const exists = await prisma.appUser.findUnique({ where: { username: parsed.data.username } });
  if (exists) {
    return { status: "error", message: `ユーザー名「${parsed.data.username}」は既に使われています` };
  }

  await prisma.appUser.create({
    data: {
      username: parsed.data.username,
      displayName: parsed.data.displayName,
      passwordHash: hashPassword(parsed.data.password),
      role: parsed.data.role,
      features: parsed.data.role === "ADMIN" ? [] : parsed.data.features,
    },
  });

  revalidatePath("/settings");
  return { status: "success", message: `${parsed.data.displayName} を追加しました` };
}

const signupPolicySchema = z.object({
  mode: z.enum(["OPEN", "CODE", "OFF"]),
  /** undefined なら変更しない。空文字なら合言葉を削除 */
  code: z.string().max(100).optional(),
});

/** ログイン画面からの新規ユーザー作成の可否を切り替える (管理者のみ) */
export async function updateSignupPolicy(input: unknown): Promise<UserActionState> {
  if (!(await requireAdmin())) {
    return { status: "error", message: "管理者のみ実行できます" };
  }
  const parsed = signupPolicySchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: "入力内容が不正です" };
  }
  const { mode, code } = parsed.data;

  if (mode === "CODE") {
    const current = await getSignupPolicy();
    // 合言葉が未設定のまま「合言葉が必要」にすると誰も作成できなくなる
    if (!current.hasCode && !code) {
      return { status: "error", message: "合言葉を入力してください" };
    }
    if (code && code.length < 4) {
      return { status: "error", message: "合言葉は4文字以上にしてください" };
    }
  }

  await saveSignupPolicy(mode, code === undefined || code === "" ? undefined : code);

  revalidatePath("/settings");
  revalidatePath("/login");
  return {
    status: "success",
    message:
      mode === "OPEN"
        ? "だれでも新規ユーザーを作成できるようにしました"
        : mode === "CODE"
          ? "合言葉を知っている人だけ作成できるようにしました"
          : "新規ユーザーの作成を停止しました",
  };
}

const updateUserSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["ADMIN", "STAFF"]),
  features: featureListSchema,
  isActive: z.boolean(),
  /** 空文字なら変更しない */
  newPassword: z.string().max(100),
});

export async function updateUser(input: unknown): Promise<UserActionState> {
  const admin = await requireAdmin();
  if (!admin) {
    return { status: "error", message: "管理者のみ実行できます" };
  }
  const parsed = updateUserSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: "入力内容が不正です" };
  }
  if (parsed.data.newPassword && parsed.data.newPassword.length < 8) {
    return { status: "error", message: "パスワードは8文字以上にしてください" };
  }

  // 自分自身を無効化・降格して締め出さないようにする
  if (parsed.data.id === admin.uid && (parsed.data.role !== "ADMIN" || !parsed.data.isActive)) {
    return { status: "error", message: "自分自身の権限を下げたり無効化することはできません" };
  }

  const user = await prisma.appUser.findUnique({ where: { id: parsed.data.id } });
  if (!user) {
    return { status: "error", message: "ユーザーが見つかりません" };
  }

  await prisma.appUser.update({
    where: { id: user.id },
    data: {
      role: parsed.data.role,
      features: parsed.data.role === "ADMIN" ? [] : parsed.data.features,
      isActive: parsed.data.isActive,
      ...(parsed.data.newPassword
        ? { passwordHash: hashPassword(parsed.data.newPassword) }
        : {}),
    },
  });

  revalidatePath("/settings");
  return { status: "success", message: `${user.displayName} を更新しました` };
}
