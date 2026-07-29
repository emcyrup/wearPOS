import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

export type MovementType =
  | "INBOUND"
  | "SALE"
  | "RETURN"
  | "TRANSFER_OUT"
  | "TRANSFER_IN"
  | "ADJUSTMENT"
  | "STOCKTAKE";

export type ApplyMovementInput = {
  storeId: string;
  variantId: string;
  type: MovementType;
  /** 増減数。マイナスで減少。STOCKTAKE の場合は「差分」ではなく実棚数を absoluteQuantity で渡す */
  quantity?: number;
  /** 棚卸で確定した実在庫数 */
  absoluteQuantity?: number;
  reason?: string;
  refType?: string;
  refId?: string;
  staffId?: string | null;
};

/**
 * 在庫を増減し、必ず StockMovement に履歴を残す。
 * 呼び出し側のトランザクション (tx) に参加できるよう client を受け取る。
 */
export async function applyStockMovement(
  client: Prisma.TransactionClient,
  input: ApplyMovementInput,
) {
  const existing = await client.inventory.findUnique({
    where: { storeId_variantId: { storeId: input.storeId, variantId: input.variantId } },
  });

  const current = existing?.quantity ?? 0;

  const delta =
    input.type === "STOCKTAKE"
      ? (input.absoluteQuantity ?? current) - current
      : (input.quantity ?? 0);

  const balance = current + delta;

  const inventory = existing
    ? await client.inventory.update({
        where: { id: existing.id },
        data: { quantity: balance },
      })
    : await client.inventory.create({
        data: { storeId: input.storeId, variantId: input.variantId, quantity: balance },
      });

  await client.stockMovement.create({
    data: {
      storeId: input.storeId,
      variantId: input.variantId,
      type: input.type,
      quantity: delta,
      balance,
      reason: input.reason,
      refType: input.refType,
      refId: input.refId,
      staffId: input.staffId ?? undefined,
    },
  });

  return inventory;
}

/** 全店舗合計の在庫数を SKU 単位で取得 */
export async function totalOnHandByVariant(variantIds: string[]) {
  if (variantIds.length === 0) return new Map<string, number>();
  const rows = await prisma.inventory.groupBy({
    by: ["variantId"],
    where: { variantId: { in: variantIds } },
    _sum: { quantity: true },
  });
  return new Map(rows.map((row) => [row.variantId, row._sum.quantity ?? 0]));
}

/** 発注点を下回っている在庫 (安全在庫割れ) */
export async function lowStockItems(limit = 20) {
  const items = await prisma.inventory.findMany({
    where: { safetyStock: { gt: 0 } },
    include: {
      store: true,
      variant: { include: { product: { include: { brand: true } } } },
    },
    orderBy: { quantity: "asc" },
    take: 200,
  });
  return items.filter((item) => item.quantity <= item.safetyStock).slice(0, limit);
}
