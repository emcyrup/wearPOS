"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ensurePaymentMethods } from "@/lib/payment-methods";

export type PaymentMethodActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

const codeSchema = z
  .string()
  .trim()
  .min(2)
  .max(20)
  .regex(/^[A-Z][A-Z0-9_]*$/, "コードは英大文字・数字・アンダースコアで入力してください");

const addSchema = z.object({
  code: codeSchema,
  label: z.string().trim().min(1).max(20),
  allowSplit: z.boolean(),
  allowChange: z.boolean(),
});

/** 支払方法を追加する (ギフト券・商品券など) */
export async function addPaymentMethod(input: unknown): Promise<PaymentMethodActionState> {
  if (!(await requireAdmin())) {
    return { status: "error", message: "管理者のみ実行できます" };
  }
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message:
        parsed.error.issues[0]?.message ??
        "コード (英大文字) と名称を入力してください",
    };
  }
  const { code, label, allowSplit, allowChange } = parsed.data;

  const exists = await prisma.paymentMethod.findUnique({ where: { code } });
  if (exists) {
    return { status: "error", message: `コード「${code}」は既に使われています` };
  }

  const last = await prisma.paymentMethod.findFirst({ orderBy: { sortOrder: "desc" } });
  await prisma.paymentMethod.create({
    data: {
      code,
      label,
      allowSplit,
      allowChange,
      isBuiltin: false,
      isActive: true,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
  });

  revalidatePath("/settings");
  revalidatePath("/register");
  return { status: "success", message: `${label} を追加しました` };
}

const updateSchema = z.object({
  code: z.string().min(1),
  label: z.string().trim().min(1).max(20),
  allowSplit: z.boolean(),
  allowChange: z.boolean(),
  isActive: z.boolean(),
});

/** 名称・分割対応・お釣り可否・有効/無効を更新する */
export async function updatePaymentMethod(input: unknown): Promise<PaymentMethodActionState> {
  if (!(await requireAdmin())) {
    return { status: "error", message: "管理者のみ実行できます" };
  }
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: "入力内容を確認してください" };
  }
  const { code, ...data } = parsed.data;

  const method = await prisma.paymentMethod.findUnique({ where: { code } });
  if (!method) return { status: "error", message: "支払方法が見つかりません" };

  // 有効な支払方法が1つも無くなるとレジで会計できなくなる
  if (!data.isActive && method.isActive) {
    const activeCount = await prisma.paymentMethod.count({ where: { isActive: true } });
    if (activeCount <= 1) {
      return { status: "error", message: "有効な支払方法を1つ以上残してください" };
    }
  }

  await prisma.paymentMethod.update({ where: { code }, data });

  revalidatePath("/settings");
  revalidatePath("/register");
  return { status: "success", message: `${data.label} を更新しました` };
}

/**
 * 支払方法を削除する。
 * 組み込みの5種と、取引で使用済みのものは削除できない (無効化して隠す)。
 */
export async function deletePaymentMethod(code: string): Promise<PaymentMethodActionState> {
  if (!(await requireAdmin())) {
    return { status: "error", message: "管理者のみ実行できます" };
  }

  const method = await prisma.paymentMethod.findUnique({ where: { code } });
  if (!method) return { status: "error", message: "支払方法が見つかりません" };
  if (method.isBuiltin) {
    return {
      status: "error",
      message: "組み込みの支払方法は削除できません。使わない場合は「レジに表示」を外してください",
    };
  }

  const usedCount = await prisma.sale.count({ where: { paymentMethod: code } });
  if (usedCount > 0) {
    // 過去の伝票の表示名を保つため、レコードは残して無効化する
    await prisma.paymentMethod.update({ where: { code }, data: { isActive: false } });
    revalidatePath("/settings");
    revalidatePath("/register");
    return {
      status: "success",
      message: `${method.label} は ${usedCount} 件の取引で使われているため、削除せずレジ非表示にしました`,
    };
  }

  await prisma.paymentMethod.delete({ where: { code } });

  revalidatePath("/settings");
  revalidatePath("/register");
  return { status: "success", message: `${method.label} を削除しました` };
}

/** 表示順を1つ入れ替える */
export async function movePaymentMethod(
  code: string,
  direction: "up" | "down",
): Promise<PaymentMethodActionState> {
  if (!(await requireAdmin())) {
    return { status: "error", message: "管理者のみ実行できます" };
  }

  const all = await ensurePaymentMethods();
  const index = all.findIndex((row) => row.code === code);
  if (index < 0) return { status: "error", message: "支払方法が見つかりません" };

  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= all.length) {
    return { status: "idle", message: "" };
  }

  const reordered = [...all];
  [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];

  await prisma.$transaction(
    reordered.map((row, order) =>
      prisma.paymentMethod.update({ where: { code: row.code }, data: { sortOrder: order } }),
    ),
  );

  revalidatePath("/settings");
  revalidatePath("/register");
  return { status: "idle", message: "" };
}
