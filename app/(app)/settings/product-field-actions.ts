"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

export type ProductFieldActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

/** 商品の基本情報にカスタム項目を追加する (例: フィット、柄、洗濯表示) */
export async function addProductField(input: unknown): Promise<ProductFieldActionState> {
  if (!(await requireAdmin())) {
    return { status: "error", message: "管理者のみ実行できます" };
  }
  const parsed = z.object({ label: z.string().trim().min(1).max(30) }).safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: "項目名は1〜30文字で入力してください" };
  }

  const duplicate = await prisma.productField.findFirst({
    where: { label: parsed.data.label },
  });
  if (duplicate) {
    return { status: "error", message: `項目「${parsed.data.label}」は既にあります` };
  }

  const max = await prisma.productField.aggregate({ _max: { sortOrder: true } });
  await prisma.productField.create({
    data: { label: parsed.data.label, sortOrder: (max._max.sortOrder ?? 0) + 1 },
  });
  revalidatePath("/settings");
  return { status: "success", message: `項目「${parsed.data.label}」を追加しました` };
}

/** カスタム項目の削除。商品に入力済みの値も一緒に消える (組み込み項目は削除不可) */
export async function deleteProductField(id: string): Promise<ProductFieldActionState> {
  if (!(await requireAdmin())) {
    return { status: "error", message: "管理者のみ実行できます" };
  }

  const field = await prisma.productField.findUnique({
    where: { id },
    include: { _count: { select: { values: true } } },
  });
  if (!field) return { status: "error", message: "項目が見つかりません" };
  if (field.builtinKey) {
    return { status: "error", message: "組み込み項目は削除できません (非表示にできます)" };
  }

  await prisma.productField.delete({ where: { id } });
  revalidatePath("/settings");
  return {
    status: "success",
    message:
      field._count.values > 0
        ? `項目「${field.label}」を削除しました (${field._count.values} 件の商品の入力値も削除)`
        : `項目「${field.label}」を削除しました`,
  };
}

/** 項目の表示 / 非表示を切り替える */
export async function setProductFieldVisibility(
  id: string,
  isVisible: boolean,
): Promise<ProductFieldActionState> {
  if (!(await requireAdmin())) {
    return { status: "error", message: "管理者のみ実行できます" };
  }

  const field = await prisma.productField.findUnique({ where: { id } });
  if (!field) return { status: "error", message: "項目が見つかりません" };

  await prisma.productField.update({ where: { id }, data: { isVisible } });
  revalidatePath("/settings");
  return {
    status: "success",
    message: `「${field.label}」を${isVisible ? "表示" : "非表示"}にしました`,
  };
}
