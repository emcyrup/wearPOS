"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { currentYearMonth, reserveSequentialJan } from "@/lib/jan";

export type AssignBarcodesState = {
  status: "idle" | "success" | "error";
  message: string;
};

/**
 * JAN コード未設定の SKU に「年月 + 連番5桁」ルールの EAN-13 を一括で採番する。
 * 年月はフォームの入力値 (未入力なら当月) を使い、後ろ5桁は自動連番。
 */
export async function assignMissingBarcodes(
  productId: string,
  _prev: AssignBarcodesState,
  formData: FormData,
): Promise<AssignBarcodesState> {
  const variants = await prisma.productVariant.findMany({
    where: { productId, OR: [{ barcode: null }, { barcode: "" }] },
    orderBy: [{ colorCode: "asc" }, { sizeOrder: "asc" }],
  });

  if (variants.length === 0) {
    return { status: "idle", message: "JAN コード未設定の SKU はありません" };
  }

  const yearMonth = String(formData.get("janYearMonth") ?? "").trim() || currentYearMonth();

  let assigned: string[];
  try {
    assigned = await reserveSequentialJan(yearMonth, variants.length);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "採番に失敗しました。再度お試しください",
    };
  }
  await prisma.$transaction(
    variants.map((variant, index) =>
      prisma.productVariant.update({
        where: { id: variant.id },
        data: { barcode: assigned[index] },
      }),
    ),
  );

  revalidatePath(`/products/${productId}`);
  revalidatePath(`/products/${productId}/labels`);

  return {
    status: "success",
    message: `${variants.length} 件の SKU に JAN コードを採番しました`,
  };
}
