import { Prisma } from "@prisma/client";

import { DORMANT_DAYS } from "@/lib/apparel";
import { prisma } from "@/lib/db";

export type DateRange = { from: Date; to: Date };

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

/** 直近 n 日間 (今日を含む) */
export function lastNDays(n: number): DateRange {
  const to = endOfDay(new Date());
  const from = startOfDay(addDays(to, -(n - 1)));
  return { from, to };
}

/** 同じ長さだけ前にずらした比較期間 */
export function previousRange(range: DateRange): DateRange {
  const span = range.to.getTime() - range.from.getTime();
  return {
    from: new Date(range.from.getTime() - span - 1),
    to: new Date(range.from.getTime() - 1),
  };
}

/**
 * 集計はすべて SQL 側で行う。
 *
 * 以前は取引と明細を丸ごと取得して JS で集計していたため、
 * ダッシュボード1画面で 32 回の問い合わせが発生していた。
 * サーバーレス環境ではデータベースとの往復遅延がそのまま表示速度に効くため、
 * 「1指標 = 1クエリ、返るのは集計済みの数行」に変更している。
 */

/** 店舗の絞り込み条件。指定が無ければ空の断片を返す */
function storeFilter(storeId: string | undefined, alias = "s") {
  return storeId
    ? Prisma.sql`AND ${Prisma.raw(`"${alias}"`)}."storeId" = ${storeId}`
    : Prisma.empty;
}

/** COUNT/SUM は bigint や numeric で返るため数値に揃える */
const num = (value: unknown): number => Number(value ?? 0);

export type SalesSummary = {
  netSales: number;
  grossSales: number;
  returns: number;
  transactionCount: number;
  itemCount: number;
  averageOrderValue: number;
  unitsPerTransaction: number;
  memberSalesRatio: number;
  properSellThrough: number;
};

/**
 * 期間の売上サマリ。返品は売上からマイナスする。
 * 伝票側の集計と明細側の集計を CTE でまとめ、1往復で取得する。
 */
export async function salesSummary(range: DateRange, storeId?: string): Promise<SalesSummary> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    WITH sale_totals AS (
      SELECT
        COALESCE(SUM(s.total) FILTER (WHERE s.type = 'SALE'), 0) AS gross,
        COALESCE(SUM(s.total) FILTER (WHERE s.type = 'RETURN'), 0) AS returns,
        COUNT(*) FILTER (WHERE s.type = 'SALE') AS orders,
        COALESCE(SUM(s.total) FILTER (WHERE s.type = 'SALE' AND s."customerId" IS NOT NULL), 0) AS member_sales
      FROM "Sale" s
      WHERE s."soldAt" BETWEEN ${range.from} AND ${range.to}
      ${storeFilter(storeId)}
    ),
    line_totals AS (
      SELECT
        COALESCE(SUM(l.quantity), 0) AS items,
        COALESCE(SUM(l.quantity) FILTER (
          WHERE l."listPriceAtSale" > 0
            AND l."unitPrice" - (l.discount::numeric / NULLIF(l.quantity, 0)) >= l."listPriceAtSale"
        ), 0) AS proper_items
      FROM "SaleLine" l
      JOIN "Sale" s ON s.id = l."saleId"
      WHERE s.type = 'SALE'
        AND s."soldAt" BETWEEN ${range.from} AND ${range.to}
        ${storeFilter(storeId)}
    )
    SELECT * FROM sale_totals, line_totals
  `);

  const row = rows[0] ?? {};
  const grossSales = num(row.gross);
  const returns = num(row.returns);
  const transactionCount = num(row.orders);
  const itemCount = num(row.items);
  const properItems = num(row.proper_items);
  const memberSales = num(row.member_sales);

  return {
    netSales: grossSales - returns,
    grossSales,
    returns,
    transactionCount,
    itemCount,
    averageOrderValue: transactionCount ? Math.round(grossSales / transactionCount) : 0,
    unitsPerTransaction: transactionCount ? itemCount / transactionCount : 0,
    memberSalesRatio: grossSales ? memberSales / grossSales : 0,
    properSellThrough: itemCount ? properItems / itemCount : 0,
  };
}

/** 日別売上の推移。取引が無い日も 0 で埋めてグラフが途切れないようにする */
export async function dailySalesTrend(range: DateRange, storeId?: string) {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT
      date_trunc('day', s."soldAt") AS day,
      COALESCE(SUM(CASE WHEN s.type = 'RETURN' THEN -s.total ELSE s.total END), 0) AS sales,
      COUNT(*) FILTER (WHERE s.type = 'SALE') AS orders
    FROM "Sale" s
    WHERE s."soldAt" BETWEEN ${range.from} AND ${range.to}
    ${storeFilter(storeId)}
    GROUP BY 1
    ORDER BY 1
  `);

  const byDate = new Map(
    rows.map((row) => [
      startOfDay(new Date(row.day as string)).toISOString().slice(0, 10),
      { sales: num(row.sales), orders: num(row.orders) },
    ]),
  );

  const buckets: { date: string; sales: number; orders: number }[] = [];
  for (let d = startOfDay(range.from); d <= range.to; d = addDays(d, 1)) {
    const key = d.toISOString().slice(0, 10);
    const found = byDate.get(key);
    buckets.push({ date: key, sales: found?.sales ?? 0, orders: found?.orders ?? 0 });
  }
  return buckets;
}

/** 店舗別売上 */
export async function salesByStore(range: DateRange) {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT st.id AS store_id, st.name AS store_name,
           COALESCE(SUM(s.total), 0) AS sales,
           COUNT(*) AS orders
    FROM "Sale" s
    JOIN "Store" st ON st.id = s."storeId"
    WHERE s.type = 'SALE' AND s."soldAt" BETWEEN ${range.from} AND ${range.to}
    GROUP BY st.id, st.name
    ORDER BY sales DESC
  `);

  return rows.map((row) => ({
    storeId: String(row.store_id),
    storeName: String(row.store_name),
    sales: num(row.sales),
    orders: num(row.orders),
  }));
}

/** スタッフ別売上 */
export async function salesByStaff(range: DateRange, storeId?: string, limit = 10) {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT sf.id AS staff_id, sf.name AS staff_name,
           COALESCE(SUM(s.total), 0) AS sales,
           COUNT(*) AS orders
    FROM "Sale" s
    JOIN "Staff" sf ON sf.id = s."staffId"
    WHERE s.type = 'SALE' AND s."soldAt" BETWEEN ${range.from} AND ${range.to}
    ${storeFilter(storeId)}
    GROUP BY sf.id, sf.name
    ORDER BY sales DESC
    LIMIT ${limit}
  `);

  return rows.map((row) => {
    const sales = num(row.sales);
    const orders = num(row.orders);
    return {
      staffId: String(row.staff_id),
      staffName: String(row.staff_name),
      sales,
      orders,
      averageOrderValue: orders ? Math.round(sales / orders) : 0,
    };
  });
}

/** SKU 別の売れ筋ランキング */
export async function topSellingVariants(range: DateRange, storeId?: string, limit = 10) {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT v.id AS variant_id, v.sku, v."colorName", v."sizeName",
           p.name AS product_name, p."styleCode",
           b.name AS brand_name, se.code AS season_code,
           SUM(l.quantity) AS quantity,
           SUM(l."lineTotal") AS sales
    FROM "SaleLine" l
    JOIN "Sale" s ON s.id = l."saleId"
    JOIN "ProductVariant" v ON v.id = l."variantId"
    JOIN "Product" p ON p.id = v."productId"
    JOIN "Brand" b ON b.id = p."brandId"
    JOIN "Season" se ON se.id = p."seasonId"
    WHERE s.type = 'SALE' AND s."soldAt" BETWEEN ${range.from} AND ${range.to}
    ${storeFilter(storeId)}
    GROUP BY v.id, v.sku, v."colorName", v."sizeName", p.name, p."styleCode", b.name, se.code
    ORDER BY quantity DESC
    LIMIT ${limit}
  `);

  return rows.map((row) => ({
    variantId: String(row.variant_id),
    sku: String(row.sku),
    productName: String(row.product_name),
    styleCode: String(row.styleCode),
    brandName: String(row.brand_name),
    seasonCode: String(row.season_code),
    colorName: String(row.colorName),
    sizeName: String(row.sizeName),
    quantity: num(row.quantity),
    sales: num(row.sales),
  }));
}

/** カラー別・サイズ別の販売構成 (アパレルの定番分析軸)。1往復で両方を取得する */
export async function salesByColorAndSize(range: DateRange, storeId?: string) {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT 'color' AS axis, v."colorName" AS name, MIN(v."colorHex") AS hex, 0 AS sort,
           SUM(l.quantity) AS quantity, SUM(l."lineTotal") AS sales
    FROM "SaleLine" l
    JOIN "Sale" s ON s.id = l."saleId"
    JOIN "ProductVariant" v ON v.id = l."variantId"
    WHERE s.type = 'SALE' AND s."soldAt" BETWEEN ${range.from} AND ${range.to}
    ${storeFilter(storeId)}
    GROUP BY v."colorName"

    UNION ALL

    SELECT 'size', v."sizeName", NULL, MIN(v."sizeOrder"),
           SUM(l.quantity), SUM(l."lineTotal")
    FROM "SaleLine" l
    JOIN "Sale" s ON s.id = l."saleId"
    JOIN "ProductVariant" v ON v.id = l."variantId"
    WHERE s.type = 'SALE' AND s."soldAt" BETWEEN ${range.from} AND ${range.to}
    ${storeFilter(storeId)}
    GROUP BY v."sizeName"
  `);

  const colors = rows
    .filter((row) => row.axis === "color")
    .map((row) => ({
      name: String(row.name),
      hex: (row.hex as string | null) ?? null,
      quantity: num(row.quantity),
      sales: num(row.sales),
    }))
    .sort((a, b) => b.quantity - a.quantity);

  const sizes = rows
    .filter((row) => row.axis === "size")
    .map((row) => ({
      name: String(row.name),
      order: num(row.sort),
      quantity: num(row.quantity),
      sales: num(row.sales),
    }))
    .sort((a, b) => a.order - b.order);

  return { colors, sizes };
}

/** シーズン別の売上構成。今季と過去シーズンの比率、プロパー消化率を見る */
export async function salesBySeason(range: DateRange, storeId?: string) {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT se.code, se.name,
           SUM(l.quantity) AS quantity,
           SUM(l."lineTotal") AS sales,
           COALESCE(SUM(l.quantity) FILTER (
             WHERE l."listPriceAtSale" > 0
               AND l."unitPrice" - (l.discount::numeric / NULLIF(l.quantity, 0)) >= l."listPriceAtSale"
           ), 0) AS proper_quantity
    FROM "SaleLine" l
    JOIN "Sale" s ON s.id = l."saleId"
    JOIN "ProductVariant" v ON v.id = l."variantId"
    JOIN "Product" p ON p.id = v."productId"
    JOIN "Season" se ON se.id = p."seasonId"
    WHERE s.type = 'SALE' AND s."soldAt" BETWEEN ${range.from} AND ${range.to}
    ${storeFilter(storeId)}
    GROUP BY se.code, se.name
    ORDER BY sales DESC
  `);

  return rows.map((row) => {
    const quantity = num(row.quantity);
    return {
      code: String(row.code),
      name: String(row.name),
      quantity,
      sales: num(row.sales),
      properRate: quantity ? num(row.proper_quantity) / quantity : 0,
    };
  });
}

export type CustomerInsights = {
  totalCustomers: number;
  newCustomers: number;
  repeatRate: number;
  dormantCustomers: number;
  lineLinkedCount: number;
  lineLinkRate: number;
  rankCounts: { rank: string; count: number }[];
};

/** 顧客サイドの指標。ランク別の件数と全体の指標を1往復で取得する */
export async function customerInsights(range: DateRange): Promise<CustomerInsights> {
  const dormantBefore = addDays(new Date(), -DORMANT_DAYS);

  const rows = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT c.rank,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE c."visitCount" > 1) AS repeaters,
           COUNT(*) FILTER (WHERE c."firstVisitAt" BETWEEN ${range.from} AND ${range.to}) AS newcomers,
           COUNT(*) FILTER (WHERE c."lastVisitAt" < ${dormantBefore}) AS dormant,
           (SELECT COUNT(*) FROM "LineAccount" la WHERE la."isFollowing") AS line_linked
    FROM "Customer" c
    WHERE c."isActive"
    GROUP BY c.rank
  `);

  const totalCustomers = rows.reduce((sum, row) => sum + num(row.total), 0);
  const repeatCustomers = rows.reduce((sum, row) => sum + num(row.repeaters), 0);
  const lineLinkedCount = num(rows[0]?.line_linked);

  return {
    totalCustomers,
    newCustomers: rows.reduce((sum, row) => sum + num(row.newcomers), 0),
    repeatRate: totalCustomers ? repeatCustomers / totalCustomers : 0,
    dormantCustomers: rows.reduce((sum, row) => sum + num(row.dormant), 0),
    lineLinkedCount,
    lineLinkRate: totalCustomers ? lineLinkedCount / totalCustomers : 0,
    rankCounts: rows.map((row) => ({ rank: String(row.rank), count: num(row.total) })),
  };
}

/** 発注点を下回っている在庫 (安全在庫割れ) */
export async function lowStockItems(limit = 8) {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT i.id, i.quantity, i."safetyStock",
           st.name AS store_name,
           v.sku, p.name AS product_name
    FROM "Inventory" i
    JOIN "Store" st ON st.id = i."storeId"
    JOIN "ProductVariant" v ON v.id = i."variantId"
    JOIN "Product" p ON p.id = v."productId"
    WHERE i."safetyStock" > 0 AND i.quantity <= i."safetyStock"
    ORDER BY i.quantity ASC, v.sku ASC
    LIMIT ${limit}
  `);

  return rows.map((row) => ({
    id: String(row.id),
    quantity: num(row.quantity),
    safetyStock: num(row.safetyStock),
    storeName: String(row.store_name),
    sku: String(row.sku),
    productName: String(row.product_name),
  }));
}
