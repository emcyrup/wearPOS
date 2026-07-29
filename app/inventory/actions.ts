"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { applyStockMovement } from "@/lib/inventory";

const adjustSchema = z.object({
  storeId: z.string().min(1, "店舗を選択してください"),
  /** SKU コードまたは JAN バーコード */
  skuOrBarcode: z.string().min(1, "SKU またはバーコードを入力してください"),
  type: z.enum(["INBOUND", "ADJUSTMENT", "STOCKTAKE"]),
  quantity: z.coerce.number().int(),
  reason: z.string().optional(),
  staffId: z.string().optional(),
});

export type AdjustState = { status: "idle" | "success" | "error"; message: string };

/**
 * 在庫を手動で増減する。
 * INBOUND/ADJUSTMENT は差分、STOCKTAKE は実棚数として扱う。
 */
export async function adjustStock(_prev: AdjustState, formData: FormData): Promise<AdjustState> {
  const parsed = adjustSchema.safeParse({
    storeId: formData.get("storeId"),
    skuOrBarcode: formData.get("skuOrBarcode"),
    type: formData.get("type"),
    quantity: formData.get("quantity"),
    reason: formData.get("reason"),
    staffId: formData.get("staffId") || undefined,
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "入力内容を確認してください" };
  }

  const input = parsed.data;
  const code = input.skuOrBarcode.trim();

  const variant = await prisma.productVariant.findFirst({
    where: { OR: [{ sku: code }, { barcode: code }] },
    include: { product: true },
  });

  if (!variant) {
    return { status: "error", message: `SKU が見つかりません: ${code}` };
  }

  if (input.type !== "STOCKTAKE" && input.quantity === 0) {
    return { status: "error", message: "増減数に 0 は指定できません" };
  }
  if (input.type === "STOCKTAKE" && input.quantity < 0) {
    return { status: "error", message: "棚卸の実棚数にマイナスは指定できません" };
  }

  const inventory = await prisma.$transaction((tx) =>
    applyStockMovement(tx, {
      storeId: input.storeId,
      variantId: variant.id,
      type: input.type,
      quantity: input.type === "STOCKTAKE" ? undefined : input.quantity,
      absoluteQuantity: input.type === "STOCKTAKE" ? input.quantity : undefined,
      reason: input.reason || undefined,
      staffId: input.staffId ?? null,
    }),
  );

  revalidatePath("/inventory");
  revalidatePath(`/products/${variant.productId}`);

  return {
    status: "success",
    message: `${variant.product.name} (${variant.sku}) の在庫を ${inventory.quantity} に更新しました`,
  };
}
