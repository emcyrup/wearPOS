import { z } from "zod";

import { calcEarnedPoints, rankForSpent } from "@/lib/apparel";
import { prisma } from "@/lib/db";
import { applyStockMovement } from "@/lib/inventory";

/**
 * 外部 POS レジから送られてくる取引ペイロード。
 * SKU は sku コードか barcode(JAN) のどちらかで指定できる。
 */
export const posSaleLineSchema = z
  .object({
    sku: z.string().min(1).optional(),
    barcode: z.string().min(1).optional(),
    quantity: z.number().int().refine((n) => n !== 0, "quantity must not be 0"),
    unitPrice: z.number().int().nonnegative(),
    discount: z.number().int().nonnegative().default(0),
  })
  .refine((line) => line.sku || line.barcode, {
    message: "sku か barcode のいずれかが必要です",
  });

export const posSaleSchema = z.object({
  /** POS 側の取引ID。同じ値で再送されても二重計上しない */
  externalId: z.string().min(1),
  receiptNo: z.string().min(1).optional(),
  storeCode: z.string().min(1),
  staffCode: z.string().min(1).optional(),
  /** 会員番号。未指定なら非会員取引として扱う */
  memberCode: z.string().min(1).optional(),
  soldAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
  type: z.enum(["SALE", "RETURN"]).default("SALE"),
  paymentMethod: z.enum(["CASH", "CREDIT", "E_MONEY", "QR", "OTHER"]).default("CASH"),
  /** 伝票値引き(税抜) */
  discount: z.number().int().nonnegative().default(0),
  /** ポイント利用による充当額(円) */
  pointsUsed: z.number().int().nonnegative().default(0),
  note: z.string().optional(),
  lines: z.array(posSaleLineSchema).min(1),
});

export type PosSaleInput = z.infer<typeof posSaleSchema>;

export class SaleIngestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "SaleIngestError";
  }
}

export type IngestResult = {
  saleId: string;
  receiptNo: string;
  duplicated: boolean;
  pointsEarned: number;
  customerId: string | null;
  lineNotification: { customerId: string; lineUserId: string } | null;
};

/**
 * POS 取引を取り込む。
 * 伝票の作成・在庫の増減・顧客実績とポイントの更新を 1 トランザクションで行う。
 * 同じ externalId が既にあれば何もせず既存の結果を返す (冪等)。
 */
export async function ingestPosSale(input: PosSaleInput): Promise<IngestResult> {
  const existing = await prisma.sale.findUnique({
    where: { externalId: input.externalId },
  });
  if (existing) {
    return {
      saleId: existing.id,
      receiptNo: existing.receiptNo,
      duplicated: true,
      pointsEarned: existing.pointsEarned,
      customerId: existing.customerId,
      lineNotification: null,
    };
  }

  const store = await prisma.store.findUnique({ where: { code: input.storeCode } });
  if (!store) throw new SaleIngestError(`店舗コードが見つかりません: ${input.storeCode}`, 404);

  const staff = input.staffCode
    ? await prisma.staff.findUnique({ where: { code: input.staffCode } })
    : null;
  if (input.staffCode && !staff) {
    throw new SaleIngestError(`スタッフコードが見つかりません: ${input.staffCode}`, 404);
  }

  const customer = input.memberCode
    ? await prisma.customer.findUnique({ where: { memberCode: input.memberCode } })
    : null;
  if (input.memberCode && !customer) {
    throw new SaleIngestError(`会員番号が見つかりません: ${input.memberCode}`, 404);
  }

  // SKU / バーコードを解決
  const skus = input.lines.map((line) => line.sku).filter((v): v is string => Boolean(v));
  const barcodes = input.lines.map((line) => line.barcode).filter((v): v is string => Boolean(v));
  const variants = await prisma.productVariant.findMany({
    where: { OR: [{ sku: { in: skus } }, { barcode: { in: barcodes } }] },
    include: { product: true },
  });
  const bySku = new Map(variants.map((v) => [v.sku, v]));
  const byBarcode = new Map(
    variants.filter((v) => v.barcode).map((v) => [v.barcode as string, v]),
  );

  const resolved = input.lines.map((line) => {
    const variant = (line.sku && bySku.get(line.sku)) || (line.barcode && byBarcode.get(line.barcode));
    if (!variant) {
      throw new SaleIngestError(`商品が見つかりません: ${line.sku ?? line.barcode}`, 404);
    }
    const lineTotal = line.unitPrice * line.quantity - line.discount;
    return { line, variant, lineTotal };
  });

  const isReturn = input.type === "RETURN";
  const subtotal = resolved.reduce((sum, item) => sum + item.lineTotal, 0);
  // 税率は品番ごとに持つため、明細単位で税額を積み上げる
  const taxableBase = Math.max(0, subtotal - input.discount);
  const weightedTaxRate =
    subtotal === 0
      ? 0.1
      : resolved.reduce((sum, item) => sum + item.variant.product.taxRate * item.lineTotal, 0) /
        subtotal;
  const tax = Math.round(taxableBase * weightedTaxRate);
  const total = taxableBase + tax;

  // ポイント利用分を差し引いた正味支払額に対して付与する
  const netPaid = Math.max(0, total - input.pointsUsed);
  const pointsEarned = customer && !isReturn ? calcEarnedPoints(netPaid, customer.rank) : 0;

  const soldAt = new Date(input.soldAt);
  const receiptNo = input.receiptNo ?? `${store.code}-${input.externalId}`;

  const result = await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.create({
      data: {
        receiptNo,
        externalId: input.externalId,
        source: "POS",
        storeId: store.id,
        staffId: staff?.id,
        customerId: customer?.id,
        soldAt,
        subtotal,
        discount: input.discount,
        tax,
        total,
        pointsUsed: input.pointsUsed,
        pointsEarned,
        paymentMethod: input.paymentMethod,
        type: input.type,
        note: input.note,
        lines: {
          create: resolved.map(({ line, variant, lineTotal }) => ({
            variantId: variant.id,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discount: line.discount,
            lineTotal,
            listPriceAtSale: variant.product.listPrice,
          })),
        },
      },
    });

    // 在庫を動かす。販売は減算、返品は加算
    for (const { line, variant } of resolved) {
      await applyStockMovement(tx, {
        storeId: store.id,
        variantId: variant.id,
        type: isReturn ? "RETURN" : "SALE",
        quantity: isReturn ? Math.abs(line.quantity) : -line.quantity,
        refType: "SALE",
        refId: sale.id,
        staffId: staff?.id ?? null,
        reason: isReturn ? "返品による戻し入れ" : "POS販売",
      });
    }

    if (!customer) return { sale, customerId: null as string | null };

    // 顧客実績・ランク・ポイントを更新
    const signedTotal = isReturn ? -total : total;
    const totalSpent = Math.max(0, customer.totalSpent + signedTotal);
    const nextRank = rankForSpent(totalSpent);
    let balance = customer.points;

    if (input.pointsUsed > 0) {
      balance -= input.pointsUsed;
      await tx.pointEvent.create({
        data: {
          customerId: customer.id,
          type: "REDEEM",
          points: -input.pointsUsed,
          balance,
          saleId: sale.id,
          note: `${receiptNo} でのポイント利用`,
        },
      });
    }

    if (pointsEarned > 0) {
      balance += pointsEarned;
      await tx.pointEvent.create({
        data: {
          customerId: customer.id,
          type: "EARN",
          points: pointsEarned,
          balance,
          saleId: sale.id,
          note: `${receiptNo} のお買い上げ`,
        },
      });
    }

    await tx.customer.update({
      where: { id: customer.id },
      data: {
        points: balance,
        totalSpent,
        rank: nextRank,
        visitCount: isReturn ? customer.visitCount : customer.visitCount + 1,
        firstVisitAt: customer.firstVisitAt ?? soldAt,
        lastVisitAt: isReturn ? customer.lastVisitAt : soldAt,
      },
    });

    return { sale, customerId: customer.id };
  });

  // LINE 通知は外部 API 呼び出しなのでトランザクション外で行う
  let lineNotification: IngestResult["lineNotification"] = null;
  if (result.customerId && !isReturn) {
    const account = await prisma.lineAccount.findUnique({
      where: { customerId: result.customerId },
    });
    if (account?.isFollowing) {
      lineNotification = { customerId: result.customerId, lineUserId: account.lineUserId };
    }
  }

  return {
    saleId: result.sale.id,
    receiptNo: result.sale.receiptNo,
    duplicated: false,
    pointsEarned,
    customerId: result.customerId,
    lineNotification,
  };
}
