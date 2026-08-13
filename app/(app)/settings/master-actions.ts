"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

export type MasterActionState = { status: "idle" | "success" | "error"; message: string };

// ---------------------------------------------------------------------------
// カテゴリ
// ---------------------------------------------------------------------------

const addCategorySchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9_-]{1,20}$/),
  name: z.string().trim().min(1).max(30),
});

export async function addCategory(input: unknown): Promise<MasterActionState> {
  if (!(await requireAdmin())) {
    return { status: "error", message: "管理者のみ実行できます" };
  }
  const parsed = addCategorySchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: "入力内容を確認してください (コードは20文字以内の半角英数字)",
    };
  }

  const code = parsed.data.code.toUpperCase();
  const exists = await prisma.category.findUnique({ where: { code } });
  if (exists) {
    return { status: "error", message: `カテゴリコード「${code}」は既にあります` };
  }

  await prisma.category.create({ data: { code, name: parsed.data.name } });
  revalidatePath("/products");
  revalidatePath("/settings");
  return { status: "success", message: `カテゴリ「${parsed.data.name}」を追加しました` };
}

export async function deleteCategory(id: string): Promise<MasterActionState> {
  if (!(await requireAdmin())) {
    return { status: "error", message: "管理者のみ実行できます" };
  }

  const category = await prisma.category.findUnique({
    where: { id },
    include: { _count: { select: { products: true, children: true } } },
  });
  if (!category) {
    return { status: "error", message: "カテゴリが見つかりません" };
  }
  // 商品や子カテゴリから参照されているものは消せない (取引履歴の整合性を守る)
  if (category._count.products > 0) {
    return {
      status: "error",
      message: `「${category.name}」は ${category._count.products} 件の商品で使われているため削除できません`,
    };
  }
  if (category._count.children > 0) {
    return { status: "error", message: `「${category.name}」には子カテゴリがあるため削除できません` };
  }

  await prisma.category.delete({ where: { id } });
  revalidatePath("/products");
  revalidatePath("/settings");
  return { status: "success", message: `カテゴリ「${category.name}」を削除しました` };
}

// ---------------------------------------------------------------------------
// ブランド
// ---------------------------------------------------------------------------

const addBrandSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9_-]{1,20}$/),
  name: z.string().trim().min(1).max(30),
});

export async function addBrand(input: unknown): Promise<MasterActionState> {
  if (!(await requireAdmin())) {
    return { status: "error", message: "管理者のみ実行できます" };
  }
  const parsed = addBrandSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: "入力内容を確認してください (コードは20文字以内の半角英数字)",
    };
  }

  const code = parsed.data.code.toUpperCase();
  const exists = await prisma.brand.findUnique({ where: { code } });
  if (exists) {
    return { status: "error", message: `ブランドコード「${code}」は既にあります` };
  }

  await prisma.brand.create({ data: { code, name: parsed.data.name } });
  revalidatePath("/products");
  revalidatePath("/settings");
  return { status: "success", message: `ブランド「${parsed.data.name}」を追加しました` };
}

export async function deleteBrand(id: string): Promise<MasterActionState> {
  if (!(await requireAdmin())) {
    return { status: "error", message: "管理者のみ実行できます" };
  }

  const brand = await prisma.brand.findUnique({
    where: { id },
    include: { _count: { select: { products: true } } },
  });
  if (!brand) {
    return { status: "error", message: "ブランドが見つかりません" };
  }
  if (brand._count.products > 0) {
    return {
      status: "error",
      message: `「${brand.name}」は ${brand._count.products} 件の商品で使われているため削除できません`,
    };
  }

  await prisma.brand.delete({ where: { id } });
  revalidatePath("/products");
  revalidatePath("/settings");
  return { status: "success", message: `ブランド「${brand.name}」を削除しました` };
}

// ---------------------------------------------------------------------------
// シーズン
// ---------------------------------------------------------------------------

const SEASON_TERM_NAMES: Record<string, string> = { SS: "春夏", AW: "秋冬", ALL: "通年定番" };

const addSeasonSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  term: z.enum(["SS", "AW", "ALL"]),
});

/**
 * シーズンの追加。コード (例: 2027SS) と期間は年・区分から自動で組み立てる。
 * SS: 2/1〜7/31、AW: 8/1〜翌1/31、ALL: 1/1〜12/31
 */
export async function addSeason(input: unknown): Promise<MasterActionState> {
  if (!(await requireAdmin())) {
    return { status: "error", message: "管理者のみ実行できます" };
  }
  const parsed = addSeasonSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: "年 (西暦) と区分を確認してください" };
  }

  const { year, term } = parsed.data;
  const code = `${year}${term}`;
  const exists = await prisma.season.findUnique({ where: { code } });
  if (exists) {
    return { status: "error", message: `シーズン「${code}」は既にあります` };
  }

  const ranges: Record<string, { start: [number, number]; end: [number, number, number] }> = {
    SS: { start: [1, 1], end: [6, 31, 0] }, // 2/1 - 7/31 (month は 0 始まり)
    AW: { start: [7, 1], end: [0, 31, 1] }, // 8/1 - 翌1/31
    ALL: { start: [0, 1], end: [11, 31, 0] }, // 1/1 - 12/31
  };
  const range = ranges[term];
  const startsOn = new Date(Date.UTC(year, range.start[0], range.start[1]));
  const endsOn = new Date(Date.UTC(year + range.end[2], range.end[0], range.end[1]));
  const name = `${year}年 ${SEASON_TERM_NAMES[term]}`;

  await prisma.season.create({ data: { code, name, year, term, startsOn, endsOn } });
  revalidatePath("/settings");
  revalidatePath("/products");
  return { status: "success", message: `シーズン「${code} (${name})」を追加しました` };
}

export async function deleteSeason(id: string): Promise<MasterActionState> {
  if (!(await requireAdmin())) {
    return { status: "error", message: "管理者のみ実行できます" };
  }

  const season = await prisma.season.findUnique({
    where: { id },
    include: { _count: { select: { products: true } } },
  });
  if (!season) return { status: "error", message: "シーズンが見つかりません" };
  if (season._count.products > 0) {
    return {
      status: "error",
      message: `「${season.code}」は ${season._count.products} 件の商品で使われているため削除できません`,
    };
  }

  await prisma.season.delete({ where: { id } });
  revalidatePath("/settings");
  revalidatePath("/products");
  return { status: "success", message: `シーズン「${season.code}」を削除しました` };
}

// ---------------------------------------------------------------------------
// 担当スタッフ
// ---------------------------------------------------------------------------

const addStaffSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9_-]{1,20}$/),
  name: z.string().trim().min(1).max(30),
  /** 空文字なら所属なし (全店舗) */
  storeId: z.string().trim(),
  role: z.enum(["STAFF", "MANAGER"]),
});

export async function addStaff(input: unknown): Promise<MasterActionState> {
  if (!(await requireAdmin())) {
    return { status: "error", message: "管理者のみ実行できます" };
  }
  const parsed = addStaffSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: "入力内容を確認してください (コードは20文字以内の半角英数字)",
    };
  }

  const code = parsed.data.code.toUpperCase();
  const exists = await prisma.staff.findUnique({ where: { code } });
  if (exists) {
    return { status: "error", message: `スタッフコード「${code}」は既にあります` };
  }
  if (parsed.data.storeId) {
    const store = await prisma.store.findUnique({ where: { id: parsed.data.storeId } });
    if (!store) return { status: "error", message: "店舗が見つかりません" };
  }

  await prisma.staff.create({
    data: {
      code,
      name: parsed.data.name,
      role: parsed.data.role,
      storeId: parsed.data.storeId || null,
    },
  });
  revalidatePath("/settings");
  return { status: "success", message: `スタッフ「${parsed.data.name}」を追加しました` };
}

/**
 * スタッフの削除。
 * 販売実績や在庫移動の履歴があるスタッフは、履歴を守るため削除ではなく無効化する。
 */
export async function deleteStaff(id: string): Promise<MasterActionState> {
  if (!(await requireAdmin())) {
    return { status: "error", message: "管理者のみ実行できます" };
  }

  const staff = await prisma.staff.findUnique({
    where: { id },
    include: { _count: { select: { sales: true, movements: true } } },
  });
  if (!staff) {
    return { status: "error", message: "スタッフが見つかりません" };
  }

  if (staff._count.sales > 0 || staff._count.movements > 0) {
    if (!staff.isActive) {
      return { status: "error", message: `「${staff.name}」は既に無効化されています` };
    }
    await prisma.staff.update({ where: { id }, data: { isActive: false } });
    revalidatePath("/settings");
    return {
      status: "success",
      message: `「${staff.name}」には取引履歴があるため、削除の代わりに無効化しました (レジの担当者候補から外れます)`,
    };
  }

  await prisma.staff.delete({ where: { id } });
  revalidatePath("/settings");
  return { status: "success", message: `スタッフ「${staff.name}」を削除しました` };
}

/** 無効化したスタッフを再度有効にする */
export async function restoreStaff(id: string): Promise<MasterActionState> {
  if (!(await requireAdmin())) {
    return { status: "error", message: "管理者のみ実行できます" };
  }
  const staff = await prisma.staff.findUnique({ where: { id } });
  if (!staff) return { status: "error", message: "スタッフが見つかりません" };

  await prisma.staff.update({ where: { id }, data: { isActive: true } });
  revalidatePath("/settings");
  return { status: "success", message: `「${staff.name}」を再度有効にしました` };
}
