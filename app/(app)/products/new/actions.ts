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
  originCountry: z.string().trim().max(50).default(""),
  careNote: z.string().trim().max(200).default(""),
  /** 設定で追加したカスタム項目の入力値 */
  customFields: z
    .array(z.object({ fieldId: z.string().min(1), value: z.string().trim().min(1).max(200) }))
    .max(30)
    .default([]),
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
  /**
   * バーコードの付け方。
   * AUTO   = 自店ルールで自動採番 (490 + 年月 + 連番)
   * MANUAL = メーカー値札や自店の既存バーコードをそのまま登録
   * NONE   = あとで設定する
   */
  barcodeMode: z.enum(["AUTO", "MANUAL", "NONE"]).default("AUTO"),
  /** MANUAL のときの SKU ごとのバーコード。空文字の SKU は未設定として扱う */
  manualBarcodes: z
    .array(
      z.object({
        sku: z.string().min(1),
        barcode: z
          .string()
          .trim()
          .max(64)
          .regex(/^[A-Za-z0-9._-]*$/, "バーコードは英数字・ハイフンで入力してください"),
      }),
    )
    .max(400)
    .default([]),
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

  let barcodes: (string | null)[] = [];
  if (data.barcodeMode === "AUTO") {
    try {
      barcodes = await reserveSequentialJan(data.janYearMonth ?? currentYearMonth(), variants.length);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "JAN コードの採番に失敗しました",
      };
    }
  } else if (data.barcodeMode === "MANUAL") {
    // 既存のバーコード (メーカー値札 / 自店の旧ラベル) をそのまま登録する
    const bySku = new Map(
      data.manualBarcodes.map((entry) => [entry.sku, entry.barcode.trim()]),
    );
    barcodes = variants.map((variant) => bySku.get(variant.sku)?.trim() || null);

    const entered = barcodes.filter((code): code is string => Boolean(code));
    const duplicatedInInput = entered.find((code, index) => entered.indexOf(code) !== index);
    if (duplicatedInInput) {
      return { ok: false, error: `同じバーコードが複数の SKU に入力されています: ${duplicatedInInput}` };
    }
    if (entered.length > 0) {
      const used = await prisma.productVariant.findFirst({
        where: { barcode: { in: entered } },
        select: { barcode: true, sku: true },
      });
      if (used) {
        return {
          ok: false,
          error: `バーコード ${used.barcode} は既に ${used.sku} で使われています`,
        };
      }
    }
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
          originCountry: data.originCountry || null,
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

      // カスタム項目 (設定で追加した項目) の入力値を保存する
      if (data.customFields.length > 0) {
        const validFields = await tx.productField.findMany({
          where: { id: { in: data.customFields.map((entry) => entry.fieldId) }, builtinKey: null },
          select: { id: true },
        });
        const validIds = new Set(validFields.map((field) => field.id));
        const entries = data.customFields.filter((entry) => validIds.has(entry.fieldId));
        if (entries.length > 0) {
          await tx.productFieldValue.createMany({
            data: entries.map((entry) => ({
              productId: created.id,
              fieldId: entry.fieldId,
              value: entry.value,
            })),
          });
        }
      }

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
      barcodeCount: barcodes.filter(Boolean).length,
    };
  } catch (error) {
    console.error("商品登録に失敗しました", error);
    return { ok: false, error: "登録に失敗しました。入力内容を確認して再度お試しください" };
  }
}
