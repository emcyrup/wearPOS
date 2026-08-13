"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { currentYearMonth, reserveSequentialJan } from "@/lib/jan";

export type AssignBarcodesState = {
  status: "idle" | "success" | "error";
  message: string;
};

/**
 * JAN コード未設定の SKU に「年月 + 連番5桁」ルールの EAN-13 を一括で採番する。
 * 年月はフォームの入力値 (未入力なら当月) を使い、後ろ5桁は自動連番。
 */
export async function assignMissingBarcodes(
  productId: string,
  _prev: AssignBarcodesState,
  formData: FormData,
): Promise<AssignBarcodesState> {
  const variants = await prisma.productVariant.findMany({
    where: { productId, OR: [{ barcode: null }, { barcode: "" }] },
    orderBy: [{ colorCode: "asc" }, { sizeOrder: "asc" }],
  });

  if (variants.length === 0) {
    return { status: "idle", message: "JAN コード未設定の SKU はありません" };
  }

  const yearMonth = String(formData.get("janYearMonth") ?? "").trim() || currentYearMonth();

  let assigned: string[];
  try {
    assigned = await reserveSequentialJan(yearMonth, variants.length);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "採番に失敗しました。再度お試しください",
    };
  }
  await prisma.$transaction(
    variants.map((variant, index) =>
      prisma.productVariant.update({
        where: { id: variant.id },
        data: { barcode: assigned[index] },
      }),
    ),
  );

  revalidatePath(`/products/${productId}`);
  revalidatePath(`/products/${productId}/labels`);

  return {
    status: "success",
    message: `${variants.length} 件の SKU に JAN コードを採番しました`,
  };
}

// ---------------------------------------------------------------------------
// 商品情報の編集
// ---------------------------------------------------------------------------

import { z } from "zod";

import { requireAdmin } from "@/lib/auth";

const updateProductSchema = z.object({
  productId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  brandId: z.string().min(1),
  categoryId: z.string().min(1),
  seasonId: z.string().min(1),
  material: z.string().trim().max(200),
  originCountry: z.string().trim().max(50),
  careNote: z.string().trim().max(200),
  costPrice: z.number().int().nonnegative().max(10_000_000),
  /** 販売価格 (税抜)。変更時は価格改定履歴に残す */
  currentPrice: z.number().int().nonnegative().max(10_000_000),
  taxRate: z.number().min(0).max(1),
  customFields: z
    .array(z.object({ fieldId: z.string().min(1), value: z.string().trim().max(200) }))
    .max(30)
    .default([]),
});

export type UpdateProductResult = { ok: true } | { ok: false; error: string };

/** 商品詳細からの基本情報の編集。販売価格の変更は PriceChange に履歴を残す */
export async function updateProductInfo(input: unknown): Promise<UpdateProductResult> {
  if (!(await requireAdmin())) {
    return { ok: false, error: "管理者のみ編集できます" };
  }
  const parsed = updateProductSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "入力内容を確認してください" };
  }
  const data = parsed.data;

  const product = await prisma.product.findUnique({ where: { id: data.productId } });
  if (!product) return { ok: false, error: "商品が見つかりません" };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: product.id },
        data: {
          name: data.name,
          brandId: data.brandId,
          categoryId: data.categoryId,
          seasonId: data.seasonId,
          material: data.material || null,
          originCountry: data.originCountry || null,
          careNote: data.careNote || null,
          costPrice: data.costPrice,
          currentPrice: data.currentPrice,
          taxRate: data.taxRate,
        },
      });

      // 販売価格が変わったら価格改定履歴に残す (値下げ / 訂正)
      if (data.currentPrice !== product.currentPrice) {
        await tx.priceChange.create({
          data: {
            productId: product.id,
            fromPrice: product.currentPrice,
            toPrice: data.currentPrice,
            reason: data.currentPrice < product.currentPrice ? "MARKDOWN" : "CORRECTION",
            note: "商品詳細から変更",
          },
        });
      }

      // カスタム項目: 入力ありは upsert、空にしたものは削除
      const validFields = await tx.productField.findMany({
        where: { builtinKey: null },
        select: { id: true },
      });
      const validIds = new Set(validFields.map((field) => field.id));
      for (const entry of data.customFields) {
        if (!validIds.has(entry.fieldId)) continue;
        if (entry.value) {
          await tx.productFieldValue.upsert({
            where: { productId_fieldId: { productId: product.id, fieldId: entry.fieldId } },
            update: { value: entry.value },
            create: { productId: product.id, fieldId: entry.fieldId, value: entry.value },
          });
        } else {
          await tx.productFieldValue.deleteMany({
            where: { productId: product.id, fieldId: entry.fieldId },
          });
        }
      }
    });
  } catch (error) {
    console.error("商品情報の更新に失敗しました", error);
    return { ok: false, error: "更新に失敗しました。時間をおいて再度お試しください" };
  }

  revalidatePath(`/products/${product.id}`);
  revalidatePath("/products");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// SKU コードの変更
// ---------------------------------------------------------------------------

const updateSkuSchema = z.object({
  variantId: z.string().min(1),
  sku: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[A-Za-z0-9][A-Za-z0-9\-_]*$/),
});

/**
 * SKU コードの変更。取引明細や在庫は variantId で紐づいているため、
 * コードを変えても過去の履歴はそのまま保たれる。
 */
export async function updateVariantSku(input: unknown): Promise<UpdateProductResult> {
  if (!(await requireAdmin())) {
    return { ok: false, error: "管理者のみ変更できます" };
  }
  const parsed = updateSkuSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "SKU は英数字・ハイフンで60文字以内で入力してください" };
  }
  const { variantId, sku } = parsed.data;

  const variant = await prisma.productVariant.findUnique({ where: { id: variantId } });
  if (!variant) return { ok: false, error: "SKU が見つかりません" };
  if (variant.sku === sku) return { ok: true };

  const duplicate = await prisma.productVariant.findUnique({ where: { sku } });
  if (duplicate) return { ok: false, error: `SKU「${sku}」は既に使われています` };

  await prisma.productVariant.update({ where: { id: variantId }, data: { sku } });

  revalidatePath(`/products/${variant.productId}`);
  revalidatePath("/products");
  revalidatePath("/inventory");
  return { ok: true };
}
