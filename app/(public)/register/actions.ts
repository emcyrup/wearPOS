"use server";

import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { activePaymentMethods } from "@/lib/payment-methods";
import {
  grantRegisterAccess,
  requireRegisterAccess,
  verifyRegisterCode,
} from "@/lib/register-access";
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
  // 会員情報を返すため、認可されたレジ端末かログイン済みのときだけ答える
  if (!(await requireRegisterAccess()).ok) return { found: false };

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
  /** 支払方法のコード。設定で追加できるため固定の一覧では検証しない (下で有効性を確認) */
  paymentMethod: z.string().min(1).max(20),
  /** 分割決済の内訳。1手段のみの会計では省略できる */
  payments: z
    .array(
      z.object({
        method: z.string().min(1).max(20),
        amount: z.number().int().positive(),
        tendered: z.number().int().nonnegative().optional(),
        /** 決済端末の承認番号・伝票番号などのメモ */
        note: z.string().trim().max(100).optional(),
      }),
    )
    .max(10)
    .optional(),
  /** 伝票値引き (税抜) */
  discount: z.number().int().nonnegative(),
  pointsUsed: z.number().int().nonnegative(),
  lines: z
    .array(
      z
        .object({
          sku: z.string().min(1).optional(),
          /** 未登録商品 (手入力) の表示名。sku がない明細で必須 */
          name: z.string().trim().min(1).max(100).optional(),
          quantity: z.number().int().positive().max(999),
          unitPrice: z.number().int().nonnegative(),
          /** 明細値引き (税抜・明細合計に対する額) */
          discount: z.number().int().nonnegative().default(0),
        })
        .refine((line) => line.sku || line.name, {
          message: "sku か name のいずれかが必要です",
        })
        .refine((line) => line.discount <= line.unitPrice * line.quantity, {
          message: "明細値引きが明細金額を超えています",
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
 * 入力チェックに落ちたとき、どこを直せばよいかが分かる文言にする。
 * 「会計内容が不正です」だけだと、店頭では手の打ちようがない。
 */
function checkoutInputError(error: z.ZodError): string {
  switch (error.issues[0]?.path[0]) {
    case "storeCode":
      return "店舗が設定されていません。管理者が 設定 → 店舗 を開いて店舗名を保存してください";
    case "staffCode":
      return "担当スタッフを選んでください";
    case "lines":
      return "カートの内容を確認してください。数量・金額が正しくない明細があります";
    case "payments":
    case "paymentMethod":
      return "支払いの内訳を確認してください";
    case "discount":
    case "pointsUsed":
      return "値引きとポイントの金額を確認してください";
    default:
      return "会計内容が不正です。カートを確認してください。";
  }
}

/**
 * 店頭レジからの会計。
 * POS 連携 API と同じ取り込みロジック (在庫減算・ポイント・LINE通知) を通す。
 */
export async function checkout(input: unknown): Promise<CheckoutResult> {
  // 会計は在庫とポイントを動かすため、認可されたレジ端末かログイン済みに限る
  const access = await requireRegisterAccess();
  if (!access.ok) return { ok: false, error: access.error };

  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: checkoutInputError(parsed.error) };
  }

  // レジに表示されている支払方法だけを受け付ける
  const methods = await activePaymentMethods();
  const used = parsed.data.payments?.length
    ? parsed.data.payments.map((payment) => payment.method)
    : [parsed.data.paymentMethod];

  for (const code of used) {
    const method = methods.find((row) => row.code === code);
    if (!method) {
      return { ok: false, error: "この支払方法は使えません。画面を再読み込みしてください。" };
    }
    // 分割決済で使えるのは、設定で許可した支払方法だけ
    if (used.length > 1 && !method.allowSplit) {
      return {
        ok: false,
        error: `${method.label} は分割決済に使えません。設定で「分割決済に使える」を有効にしてください。`,
      };
    }
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
      lines: parsed.data.lines,
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

// ---------------------------------------------------------------------------
// 検索 (バーコードが読み取れないとき用)
// ---------------------------------------------------------------------------

export type ProductSearchResult = {
  sku: string;
  productName: string;
  styleCode: string;
  colorName: string;
  colorHex: string | null;
  sizeName: string;
  price: number;
  listPrice: number;
  taxRate: number;
  /** 会計する店舗の在庫数 */
  stock: number;
};

/**
 * 商品名・品番・SKU で SKU を検索する。
 * 会計する店舗の在庫を添えて返し、在庫がある SKU を優先して並べる。
 */
export async function searchProducts(
  query: string,
  storeCode: string,
): Promise<ProductSearchResult[]> {
  if (!(await requireRegisterAccess()).ok) return [];

  const q = query.trim();
  if (q.length < 1) return [];

  const store = await prisma.store.findUnique({ where: { code: storeCode } });

  const variants = await prisma.productVariant.findMany({
    where: {
      isActive: true,
      product: { status: "ACTIVE" },
      OR: [
        { sku: { contains: q, mode: "insensitive" } },
        { barcode: { contains: q } },
        { colorName: { contains: q } },
        { product: { name: { contains: q } } },
        { product: { styleCode: { contains: q, mode: "insensitive" } } },
      ],
    },
    include: {
      product: true,
      inventory: store ? { where: { storeId: store.id } } : false,
    },
    orderBy: [{ product: { styleCode: "asc" } }, { colorCode: "asc" }, { sizeOrder: "asc" }],
    take: 60,
  });

  return variants
    .map((variant) => ({
      sku: variant.sku,
      productName: variant.product.name,
      styleCode: variant.product.styleCode,
      colorName: variant.colorName,
      colorHex: variant.colorHex,
      sizeName: variant.sizeName,
      price: variant.priceOverride ?? variant.product.currentPrice,
      listPrice: variant.product.listPrice,
      taxRate: variant.product.taxRate,
      stock: ("inventory" in variant && Array.isArray(variant.inventory)
        ? variant.inventory[0]?.quantity
        : 0) ?? 0,
    }))
    // 在庫がある SKU を先に見せる (店頭で渡せるものを優先)
    .sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0))
    .slice(0, 30);
}

export type MemberSearchResult = {
  memberCode: string;
  name: string;
  nameKana: string;
  rank: string;
  points: number;
  phone: string | null;
  storeName: string | null;
};

/** 氏名・カナ・電話番号・会員番号で会員を検索する */
export async function searchMembers(query: string): Promise<MemberSearchResult[]> {
  // 氏名・電話番号を返すため、認可されたレジ端末かログイン済みのときだけ答える
  if (!(await requireRegisterAccess()).ok) return [];

  const q = query.trim();
  // 1文字での総当たりを防ぐため、2文字以上を必要とする
  if (q.length < 2) return [];

  const customers = await prisma.customer.findMany({
    where: {
      isActive: true,
      OR: [
        { memberCode: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q } },
        { firstName: { contains: q } },
        { lastNameKana: { contains: q } },
        { firstNameKana: { contains: q } },
        { phone: { contains: q } },
      ],
    },
    include: { store: true },
    orderBy: { lastVisitAt: "desc" },
    take: 20,
  });

  return customers.map((customer) => ({
    memberCode: customer.memberCode,
    name: `${customer.lastName} ${customer.firstName}`.trim(),
    nameKana: `${customer.lastNameKana ?? ""} ${customer.firstNameKana ?? ""}`.trim(),
    rank: customer.rank,
    points: customer.points,
    phone: customer.phone,
    storeName: customer.store?.name ?? null,
  }));
}

// ---------------------------------------------------------------------------
// レジ端末の認可
// ---------------------------------------------------------------------------

export type RegisterUnlockState = { error: string };

/**
 * レジ端末コードを確認して、この端末を認可する。
 * 総当たりを防ぐため、失敗時は少し待たせる。
 */
export async function unlockRegister(
  _prev: RegisterUnlockState,
  formData: FormData,
): Promise<RegisterUnlockState> {
  // 認証前に誰でも呼べる入口なので、想定外の入力でも例外にしない
  const code = typeof formData?.get === "function" ? String(formData.get("code") ?? "") : "";
  if (!code.trim()) return { error: "レジ端末コードを入力してください" };

  if (!(await verifyRegisterCode(code))) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return { error: "レジ端末コードが違います" };
  }

  await grantRegisterAccess();
  redirect("/register");
}
