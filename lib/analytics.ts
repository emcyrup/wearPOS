import { DORMANT_DAYS, properSellThroughRate } from "@/lib/apparel";
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

type SaleFilter = { range: DateRange; storeId?: string };

function saleWhere({ range, storeId }: SaleFilter) {
  return {
    soldAt: { gte: range.from, lte: range.to },
    ...(storeId ? { storeId } : {}),
  };
}

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

/** 期間の売上サマリ。返品は売上からマイナスする */
export async function salesSummary(filter: SaleFilter): Promise<SalesSummary> {
  const sales = await prisma.sale.findMany({
    where: saleWhere(filter),
    select: {
      id: true,
      type: true,
      total: true,
      customerId: true,
      lines: {
        select: { quantity: true, unitPrice: true, discount: true, listPriceAtSale: true },
      },
    },
  });

  let grossSales = 0;
  let returns = 0;
  let transactionCount = 0;
  let itemCount = 0;
  let memberSales = 0;
  const allLines: { quantity: number; unitPrice: number; discount: number; listPriceAtSale: number }[] =
    [];

  for (const sale of sales) {
    const isReturn = sale.type === "RETURN";
    if (isReturn) {
      returns += sale.total;
    } else {
      grossSales += sale.total;
      transactionCount += 1;
      if (sale.customerId) memberSales += sale.total;
      for (const line of sale.lines) {
        itemCount += line.quantity;
        allLines.push(line);
      }
    }
  }

  const netSales = grossSales - returns;

  return {
    netSales,
    grossSales,
    returns,
    transactionCount,
    itemCount,
    averageOrderValue: transactionCount ? Math.round(grossSales / transactionCount) : 0,
    unitsPerTransaction: transactionCount ? itemCount / transactionCount : 0,
    memberSalesRatio: grossSales ? memberSales / grossSales : 0,
    properSellThrough: properSellThroughRate(allLines),
  };
}

/** 日別売上の推移 */
export async function dailySalesTrend(filter: SaleFilter) {
  const sales = await prisma.sale.findMany({
    where: saleWhere(filter),
    select: { soldAt: true, total: true, type: true, customerId: true, lines: { select: { quantity: true } } },
    orderBy: { soldAt: "asc" },
  });

  const buckets = new Map<string, { date: string; sales: number; items: number; orders: number }>();

  // 空の日も 0 で埋めてグラフが途切れないようにする
  for (let d = startOfDay(filter.range.from); d <= filter.range.to; d = addDays(d, 1)) {
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, { date: key, sales: 0, items: 0, orders: 0 });
  }

  for (const sale of sales) {
    const key = startOfDay(sale.soldAt).toISOString().slice(0, 10);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    const sign = sale.type === "RETURN" ? -1 : 1;
    bucket.sales += sale.total * sign;
    if (sale.type !== "RETURN") {
      bucket.orders += 1;
      bucket.items += sale.lines.reduce((sum, line) => sum + line.quantity, 0);
    }
  }

  return Array.from(buckets.values());
}

/** 店舗別売上 */
export async function salesByStore(range: DateRange) {
  const rows = await prisma.sale.groupBy({
    by: ["storeId"],
    where: { soldAt: { gte: range.from, lte: range.to }, type: "SALE" },
    _sum: { total: true },
    _count: { _all: true },
  });

  const stores = await prisma.store.findMany();
  const nameById = new Map(stores.map((s) => [s.id, s.name]));

  return rows
    .map((row) => ({
      storeId: row.storeId,
      storeName: nameById.get(row.storeId) ?? "不明な店舗",
      sales: row._sum.total ?? 0,
      orders: row._count._all,
    }))
    .sort((a, b) => b.sales - a.sales);
}

/** スタッフ別売上 */
export async function salesByStaff(filter: SaleFilter, limit = 10) {
  const rows = await prisma.sale.groupBy({
    by: ["staffId"],
    where: { ...saleWhere(filter), type: "SALE", staffId: { not: null } },
    _sum: { total: true },
    _count: { _all: true },
  });

  const staffIds = rows.map((r) => r.staffId).filter((id): id is string => Boolean(id));
  const staff = await prisma.staff.findMany({ where: { id: { in: staffIds } } });
  const byId = new Map(staff.map((s) => [s.id, s]));

  return rows
    .map((row) => ({
      staffId: row.staffId as string,
      staffName: byId.get(row.staffId as string)?.name ?? "不明",
      sales: row._sum.total ?? 0,
      orders: row._count._all,
      averageOrderValue: row._count._all ? Math.round((row._sum.total ?? 0) / row._count._all) : 0,
    }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, limit);
}

/** SKU 別の売れ筋ランキング */
export async function topSellingVariants(filter: SaleFilter, limit = 10) {
  const rows = await prisma.saleLine.groupBy({
    by: ["variantId"],
    where: { sale: { ...saleWhere(filter), type: "SALE" } },
    _sum: { quantity: true, lineTotal: true },
  });

  const sorted = rows
    .sort((a, b) => (b._sum.quantity ?? 0) - (a._sum.quantity ?? 0))
    .slice(0, limit);

  const variants = await prisma.productVariant.findMany({
    where: { id: { in: sorted.map((r) => r.variantId) } },
    include: { product: { include: { brand: true, season: true } } },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));

  return sorted
    .map((row) => {
      const variant = byId.get(row.variantId);
      if (!variant) return null;
      return {
        variantId: row.variantId,
        sku: variant.sku,
        productName: variant.product.name,
        styleCode: variant.product.styleCode,
        brandName: variant.product.brand.name,
        seasonCode: variant.product.season.code,
        colorName: variant.colorName,
        sizeName: variant.sizeName,
        quantity: row._sum.quantity ?? 0,
        sales: row._sum.lineTotal ?? 0,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);
}

/** カラー別・サイズ別の販売構成 (アパレルの定番分析軸) */
export async function salesByColorAndSize(filter: SaleFilter) {
  const lines = await prisma.saleLine.findMany({
    where: { sale: { ...saleWhere(filter), type: "SALE" } },
    select: {
      quantity: true,
      lineTotal: true,
      variant: { select: { colorName: true, colorHex: true, sizeName: true, sizeOrder: true } },
    },
  });

  const colors = new Map<string, { name: string; hex: string | null; quantity: number; sales: number }>();
  const sizes = new Map<string, { name: string; order: number; quantity: number; sales: number }>();

  for (const line of lines) {
    const color = colors.get(line.variant.colorName) ?? {
      name: line.variant.colorName,
      hex: line.variant.colorHex,
      quantity: 0,
      sales: 0,
    };
    color.quantity += line.quantity;
    color.sales += line.lineTotal;
    colors.set(line.variant.colorName, color);

    const size = sizes.get(line.variant.sizeName) ?? {
      name: line.variant.sizeName,
      order: line.variant.sizeOrder,
      quantity: 0,
      sales: 0,
    };
    size.quantity += line.quantity;
    size.sales += line.lineTotal;
    sizes.set(line.variant.sizeName, size);
  }

  return {
    colors: Array.from(colors.values()).sort((a, b) => b.quantity - a.quantity),
    sizes: Array.from(sizes.values()).sort((a, b) => a.order - b.order),
  };
}

/** シーズン別の売上構成。今季と過去シーズンの比率を見る */
export async function salesBySeason(filter: SaleFilter) {
  const lines = await prisma.saleLine.findMany({
    where: { sale: { ...saleWhere(filter), type: "SALE" } },
    select: {
      quantity: true,
      lineTotal: true,
      unitPrice: true,
      discount: true,
      listPriceAtSale: true,
      variant: { select: { product: { select: { season: { select: { code: true, name: true } } } } } },
    },
  });

  const map = new Map<
    string,
    { code: string; name: string; quantity: number; sales: number; lines: typeof lines }
  >();

  for (const line of lines) {
    const season = line.variant.product.season;
    const entry = map.get(season.code) ?? {
      code: season.code,
      name: season.name,
      quantity: 0,
      sales: 0,
      lines: [] as typeof lines,
    };
    entry.quantity += line.quantity;
    entry.sales += line.lineTotal;
    entry.lines.push(line);
    map.set(season.code, entry);
  }

  return Array.from(map.values())
    .map((entry) => ({
      code: entry.code,
      name: entry.name,
      quantity: entry.quantity,
      sales: entry.sales,
      properRate: properSellThroughRate(entry.lines),
    }))
    .sort((a, b) => b.sales - a.sales);
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

/** 顧客サイドの指標 */
export async function customerInsights(range: DateRange): Promise<CustomerInsights> {
  const dormantBefore = addDays(new Date(), -DORMANT_DAYS);

  const [totalCustomers, newCustomers, repeatCustomers, dormantCustomers, lineLinkedCount, rankRows] =
    await Promise.all([
      prisma.customer.count({ where: { isActive: true } }),
      prisma.customer.count({
        where: { isActive: true, firstVisitAt: { gte: range.from, lte: range.to } },
      }),
      prisma.customer.count({ where: { isActive: true, visitCount: { gt: 1 } } }),
      prisma.customer.count({
        where: { isActive: true, lastVisitAt: { lt: dormantBefore } },
      }),
      prisma.lineAccount.count({ where: { isFollowing: true } }),
      prisma.customer.groupBy({
        by: ["rank"],
        where: { isActive: true },
        _count: { _all: true },
      }),
    ]);

  return {
    totalCustomers,
    newCustomers,
    repeatRate: totalCustomers ? repeatCustomers / totalCustomers : 0,
    dormantCustomers,
    lineLinkedCount,
    lineLinkRate: totalCustomers ? lineLinkedCount / totalCustomers : 0,
    rankCounts: rankRows.map((row) => ({ rank: row.rank, count: row._count._all })),
  };
}
