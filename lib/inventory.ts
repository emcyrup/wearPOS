import { Prisma } from "@prisma/client";

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

export type InventoryRow = {
  id: string;
  quantity: number;
  safetyStock: number;
  storeName: string;
  sku: string;
  colorName: string;
  colorHex: string | null;
  sizeName: string;
  productId: string;
  productName: string;
  seasonCode: string;
};

/**
 * 在庫一覧。
 *
 * Prisma のネストした include は関連ごとに問い合わせが分かれるため、
 * 1画面で 12 回の往復が発生していた。結合済みの1クエリにまとめている。
 */
export async function inventoryList(params: {
  storeId?: string;
  keyword?: string;
  lowOnly?: boolean;
  limit?: number;
}): Promise<InventoryRow[]> {
  const keyword = params.keyword?.trim();
  const like = keyword ? `%${keyword}%` : null;

  const rows = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT i.id, i.quantity, i."safetyStock",
           st.name AS store_name,
           v.sku, v."colorName", v."colorHex", v."sizeName",
           p.id AS product_id, p.name AS product_name,
           se.code AS season_code
    FROM "Inventory" i
    JOIN "Store" st ON st.id = i."storeId"
    JOIN "ProductVariant" v ON v.id = i."variantId"
    JOIN "Product" p ON p.id = v."productId"
    JOIN "Season" se ON se.id = p."seasonId"
    WHERE TRUE
      ${params.storeId ? Prisma.sql`AND i."storeId" = ${params.storeId}` : Prisma.empty}
      ${params.lowOnly ? Prisma.sql`AND i.quantity <= i."safetyStock"` : Prisma.empty}
      ${
        like
          ? Prisma.sql`AND (v.sku ILIKE ${like} OR v.barcode ILIKE ${like}
              OR p.name ILIKE ${like} OR p."styleCode" ILIKE ${like})`
          : Prisma.empty
      }
    ORDER BY v.sku ASC, st.code ASC
    LIMIT ${params.limit ?? 200}
  `);

  return rows.map((row) => ({
    id: String(row.id),
    quantity: Number(row.quantity ?? 0),
    safetyStock: Number(row.safetyStock ?? 0),
    storeName: String(row.store_name),
    sku: String(row.sku),
    colorName: String(row.colorName),
    colorHex: (row.colorHex as string | null) ?? null,
    sizeName: String(row.sizeName),
    productId: String(row.product_id),
    productName: String(row.product_name),
    seasonCode: String(row.season_code),
  }));
}

export type MovementRow = {
  id: string;
  createdAt: Date;
  type: string;
  quantity: number;
  balance: number;
  storeName: string;
  sku: string;
  productName: string;
  staffName: string | null;
};

/** 直近の在庫変動。こちらも結合済みの1クエリで取得する */
export async function recentMovements(storeId?: string, limit = 20): Promise<MovementRow[]> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT m.id, m."createdAt", m.type, m.quantity, m.balance,
           st.name AS store_name, v.sku, p.name AS product_name, sf.name AS staff_name
    FROM "StockMovement" m
    JOIN "Store" st ON st.id = m."storeId"
    JOIN "ProductVariant" v ON v.id = m."variantId"
    JOIN "Product" p ON p.id = v."productId"
    LEFT JOIN "Staff" sf ON sf.id = m."staffId"
    WHERE TRUE ${storeId ? Prisma.sql`AND m."storeId" = ${storeId}` : Prisma.empty}
    ORDER BY m."createdAt" DESC
    LIMIT ${limit}
  `);

  return rows.map((row) => ({
    id: String(row.id),
    createdAt: new Date(row.createdAt as string),
    type: String(row.type),
    quantity: Number(row.quantity ?? 0),
    balance: Number(row.balance ?? 0),
    storeName: String(row.store_name),
    sku: String(row.sku),
    productName: String(row.product_name),
    staffName: (row.staff_name as string | null) ?? null,
  }));
}
