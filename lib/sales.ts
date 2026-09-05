import { z } from "zod";

import { calcEarnedPoints, rankForSpent } from "@/lib/apparel";
import { prisma } from "@/lib/db";
import { fullName } from "@/lib/format";
import { applyStockMovement } from "@/lib/inventory";
import { purchaseThanksMessage, pushLineText } from "@/lib/line";

/**
 * 外部 POS レジから送られてくる取引ペイロード。
 * SKU は sku コードか barcode(JAN) のどちらかで指定できる。
 * 未登録商品は name (商品名) を指定した手入力明細として扱い、在庫は動かさない。
 */
export const posSaleLineSchema = z
  .object({
    sku: z.string().min(1).optional(),
    barcode: z.string().min(1).optional(),
    /** 未登録商品 (手入力) の表示名 */
    name: z.string().trim().min(1).max(100).optional(),
    quantity: z.number().int().refine((n) => n !== 0, "quantity must not be 0"),
    unitPrice: z.number().int().nonnegative(),
    /** 明細値引き(税抜)。明細合計を上限とする */
    discount: z.number().int().nonnegative().default(0),
  })
  .refine((line) => line.sku || line.barcode || line.name, {
    message: "sku / barcode / name のいずれかが必要です",
  })
  .refine((line) => line.discount <= line.unitPrice * Math.abs(line.quantity), {
    message: "明細値引きが明細金額を超えています",
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
  /** 支払方法のコード。設定で追加できるため固定の一覧では検証しない */
  paymentMethod: z.string().min(1).max(20).default("CASH"),
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
    const variant =
      (line.sku && bySku.get(line.sku)) || (line.barcode && byBarcode.get(line.barcode)) || null;
    // sku / barcode 指定なのに見つからない場合のみエラー。name のみは手入力明細
    if (!variant && (line.sku || line.barcode)) {
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
      : resolved.reduce(
          (sum, item) => sum + (item.variant?.product.taxRate ?? 0.1) * item.lineTotal,
          0,
        ) / subtotal;
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
            variantId: variant?.id ?? null,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discount: line.discount,
            lineTotal,
            // 手入力商品は定価情報がないため販売単価をそのまま記録する
            listPriceAtSale: variant ? variant.product.listPrice : line.unitPrice,
            note: variant ? null : (line.name ?? "手入力商品"),
          })),
        },
      },
    });

    // 在庫を動かす。販売は減算、返品は加算 (手入力商品は在庫を持たないので対象外)
    for (const { line, variant } of resolved) {
      if (!variant) continue;
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

/**
 * 会計完了後の LINE 購入通知。
 * 外部 API 呼び出しのためトランザクションの外で呼ぶ。連携がなければ何もしない。
 */
export async function sendPurchaseLineNotification(result: IngestResult): Promise<void> {
  if (!result.lineNotification) return;

  const [customer, sale] = await Promise.all([
    prisma.customer.findUnique({ where: { id: result.lineNotification.customerId } }),
    prisma.sale.findUnique({ where: { id: result.saleId }, include: { store: true } }),
  ]);
  if (!customer || !sale) return;

  await pushLineText(
    result.lineNotification.lineUserId,
    purchaseThanksMessage({
      customerName: fullName(customer),
      storeName: sale.store.name,
      total: sale.total,
      pointsEarned: sale.pointsEarned,
      pointsBalance: customer.points,
    }),
    { customerId: customer.id, template: "PURCHASE_THANKS" },
  );
}
