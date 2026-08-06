"use server";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { prisma } from "@/lib/db";
import {
  ingestPosSale,
  SaleIngestError,
  sendPurchaseLineNotification,
} from "@/lib/sales";

export type MemberSummary = {
  found: boolean;
  memberCode?: string;
  name?: string;
  rank?: string;
  points?: number;
};

/** 会員番号から会計に必要な最小限の情報を引く */
export async function lookupMember(memberCode: string): Promise<MemberSummary> {
  const code = memberCode.trim();
  if (!code) return { found: false };

  const customer = await prisma.customer.findUnique({ where: { memberCode: code } });
  if (!customer) return { found: false };

  return {
    found: true,
    memberCode: customer.memberCode,
    name: `${customer.lastName} ${customer.firstName}`,
    rank: customer.rank,
    points: customer.points,
  };
}

const checkoutSchema = z.object({
  storeCode: z.string().min(1),
  staffCode: z.string().min(1).optional(),
  memberCode: z.string().min(1).optional(),
  paymentMethod: z.enum(["CASH", "CREDIT", "E_MONEY", "QR", "OTHER"]),
  /** 伝票値引き (税抜) */
  discount: z.number().int().nonnegative(),
  pointsUsed: z.number().int().nonnegative(),
  lines: z
    .array(
      z.object({
        sku: z.string().min(1),
        quantity: z.number().int().positive().max(999),
        unitPrice: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(100),
});

export type CheckoutResult =
  | {
      ok: true;
      saleId: string;
      receiptNo: string;
      subtotal: number;
      discount: number;
      tax: number;
      total: number;
      pointsUsed: number;
      pointsEarned: number;
    }
  | { ok: false; error: string };

/**
 * 店頭レジからの会計。
 * POS 連携 API と同じ取り込みロジック (在庫減算・ポイント・LINE通知) を通す。
 */
export async function checkout(input: unknown): Promise<CheckoutResult> {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "会計内容が不正です。カートを確認してください。" };
  }

  try {
    const uuid = randomUUID();
    const now = new Date();
    const ymd = now.toISOString().slice(2, 10).replaceAll("-", "");
    const result = await ingestPosSale({
      ...parsed.data,
      externalId: `REG-${uuid}`,
      // レシートに印字しやすい短い伝票番号
      receiptNo: `R${ymd}-${uuid.slice(0, 6).toUpperCase()}`,
      soldAt: now.toISOString(),
      type: "SALE",
      lines: parsed.data.lines.map((line) => ({ ...line, discount: 0 })),
    });

    await sendPurchaseLineNotification(result);

    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: result.saleId } });
    return {
      ok: true,
      saleId: sale.id,
      receiptNo: sale.receiptNo,
      subtotal: sale.subtotal,
      discount: sale.discount,
      tax: sale.tax,
      total: sale.total,
      pointsUsed: sale.pointsUsed,
      pointsEarned: sale.pointsEarned,
    };
  } catch (error) {
    if (error instanceof SaleIngestError) {
      return { ok: false, error: error.message };
    }
    console.error("レジ会計の処理に失敗しました", error);
    return { ok: false, error: "会計の処理に失敗しました。時間をおいて再度お試しください。" };
  }
}
