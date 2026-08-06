"use server";

import { randomInt } from "node:crypto";

import { revalidatePath } from "next/cache";

import { ean13CheckDigit } from "@/lib/barcode";
import { prisma } from "@/lib/db";

/** 社内採番用の JAN 企業プレフィックス (デモ用。実運用では GS1 で取得したコードを使う) */
const JAN_PREFIX = "49";

function generateJanCandidate(): string {
  let body = JAN_PREFIX;
  while (body.length < 12) body += String(randomInt(0, 10));
  return body + ean13CheckDigit(body);
}

export type AssignBarcodesState = {
  status: "idle" | "success" | "error";
  message: string;
};

/**
 * JAN コード未設定の SKU に有効な EAN-13 を一括で採番する。
 * 既存のバーコードとは重複しないことを確認してから割り当てる。
 */
export async function assignMissingBarcodes(
  productId: string,
  _prev: AssignBarcodesState,
  _formData: FormData,
): Promise<AssignBarcodesState> {
  const variants = await prisma.productVariant.findMany({
    where: { productId, OR: [{ barcode: null }, { barcode: "" }] },
    orderBy: [{ colorCode: "asc" }, { sizeOrder: "asc" }],
  });

  if (variants.length === 0) {
    return { status: "idle", message: "JAN コード未設定の SKU はありません" };
  }

  // 衝突しないコードを必要数ぶん確保する
  const codes = new Set<string>();
  for (let guard = 0; codes.size < variants.length && guard < 1000; guard++) {
    const candidates: string[] = [];
    while (candidates.length < variants.length - codes.size) {
      const candidate = generateJanCandidate();
      if (!codes.has(candidate)) candidates.push(candidate);
    }
    const existing = await prisma.productVariant.findMany({
      where: { barcode: { in: candidates } },
      select: { barcode: true },
    });
    const taken = new Set(existing.map((v) => v.barcode));
    for (const candidate of candidates) {
      if (!taken.has(candidate)) codes.add(candidate);
    }
  }

  if (codes.size < variants.length) {
    return { status: "error", message: "採番に失敗しました。再度お試しください" };
  }

  const assigned = [...codes];
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
