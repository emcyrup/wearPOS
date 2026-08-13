"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { buildSku, sizeOrderOf } from "@/lib/apparel";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { currentYearMonth, reserveSequentialJan } from "@/lib/jan";

const createSchema = z.object({
  styleCode: z
    .string()
    .trim()
    .min(3, "品番は3文字以上で入力してください")
    .max(32)
    .regex(/^[A-Za-z0-9-]+$/, "品番は半角英数字とハイフンで入力してください"),
  name: z.string().trim().min(1, "商品名を入力してください").max(80),
  brandId: z.string().min(1, "ブランドを選択してください"),
  categoryId: z.string().min(1, "カテゴリを選択してください"),
  seasonId: z.string().min(1, "シーズンを選択してください"),
  listPrice: z.number().int().positive("プロパー価格を入力してください").max(10_000_000),
  currentPrice: z.number().int().nonnegative().max(10_000_000),
  costPrice: z.number().int().nonnegative().max(10_000_000).default(0),
  taxRate: z.number().min(0).max(1).default(0.1),
  material: z.string().trim().max(200).default(""),
  careNote: z.string().trim().max(200).default(""),
  colors: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(10),
        name: z.string().trim().min(1).max(20),
        hex: z.string().trim().max(20).optional(),
      }),
    )
    .min(1, "カラーを1つ以上選択してください")
    .max(20),
  sizes: z
    .array(z.object({ code: z.string().trim().min(1).max(10), name: z.string().trim().min(1).max(20) }))
    .min(1, "サイズを1つ以上選択してください")
    .max(20),
  /** SKU ごとに JAN コードを自動採番するか */
  generateBarcodes: z.boolean().default(true),
  /** JAN の採番年月 (YYYY-MM)。コードは 490 + 年月(YYMM) + 連番5桁 + チェックデジット */
  janYearMonth: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "採番年月の形式が不正です (例: 2026-08)")
    .optional(),
  /** 初期在庫。店舗ごとに SKU 単位の数量を入れる */
  initialStock: z.number().int().nonnegative().max(9999).default(0),
  safetyStock: z.number().int().nonnegative().max(9999).default(0),
  /** 初期在庫を入れる店舗 (空なら在庫を作らない) */
  storeIds: z.array(z.string()).default([]),
});

export type CreateProductResult =
  | { ok: true; productId: string; styleCode: string; variantCount: number; barcodeCount: number }
  | { ok: false; error: string };

/**
 * 商品 (品番) とカラー×サイズの SKU を一括登録する。
 * JAN コードの採番と初期在庫の作成まで 1 トランザクションで行う。
 */
export async function createProduct(input: unknown): Promise<CreateProductResult> {
  if (!(await requireAdmin())) {
    return { ok: false, error: "管理者のみ登録できます" };
  }

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "入力内容を確認してください" };
  }
  const data = parsed.data;
  const styleCode = data.styleCode.toUpperCase();

  const duplicate = await prisma.product.findUnique({ where: { styleCode } });
  if (duplicate) {
    return { ok: false, error: `品番「${styleCode}」はすでに登録されています` };
  }

  // カラー×サイズの全組み合わせを SKU にする
  const variants = data.colors.flatMap((color) =>
    data.sizes.map((size) => ({
      sku: buildSku(styleCode, color.code, size.code),
      colorCode: color.code.toUpperCase(),
      colorName: color.name,
      colorHex: color.hex || null,
      sizeCode: size.code.toUpperCase(),
      sizeName: size.name,
      sizeOrder: sizeOrderOf(size.code),
    })),
  );

  const existingSkus = await prisma.productVariant.findMany({
    where: { sku: { in: variants.map((v) => v.sku) } },
    select: { sku: true },
  });
  if (existingSkus.length > 0) {
    return { ok: false, error: `SKU が重複しています: ${existingSkus[0].sku}` };
  }

  let barcodes: string[] = [];
  try {
    if (data.generateBarcodes) {
      barcodes = await reserveSequentialJan(data.janYearMonth ?? currentYearMonth(), variants.length);
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "JAN コードの採番に失敗しました",
    };
  }

  try {
    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          styleCode,
          name: data.name,
          brandId: data.brandId,
          categoryId: data.categoryId,
          seasonId: data.seasonId,
          listPrice: data.listPrice,
          currentPrice: data.currentPrice || data.listPrice,
          costPrice: data.costPrice,
          taxRate: data.taxRate,
          material: data.material || null,
          careNote: data.careNote || null,
          variants: {
            create: variants.map((variant, index) => ({
              ...variant,
              barcode: barcodes[index] ?? null,
            })),
          },
        },
        include: { variants: true },
      });

      // 初期在庫。指定した店舗すべてに同じ数量で作る
      if (data.storeIds.length > 0 && (data.initialStock > 0 || data.safetyStock > 0)) {
        await tx.inventory.createMany({
          data: data.storeIds.flatMap((storeId) =>
            created.variants.map((variant) => ({
              storeId,
              variantId: variant.id,
              quantity: data.initialStock,
              safetyStock: data.safetyStock,
            })),
          ),
        });

        // 入荷として履歴にも残す
        if (data.initialStock > 0) {
          await tx.stockMovement.createMany({
            data: data.storeIds.flatMap((storeId) =>
              created.variants.map((variant) => ({
                storeId,
                variantId: variant.id,
                type: "INBOUND",
                quantity: data.initialStock,
                balance: data.initialStock,
                reason: "商品登録時の初期在庫",
              })),
            ),
          });
        }
      }

      return created;
    });

    revalidatePath("/products");
    revalidatePath("/inventory");

    return {
      ok: true,
      productId: product.id,
      styleCode,
      variantCount: variants.length,
      barcodeCount: barcodes.length,
    };
  } catch (error) {
    console.error("商品登録に失敗しました", error);
    return { ok: false, error: "登録に失敗しました。入力内容を確認して再度お試しください" };
  }
}
