"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ensureDefaultStore } from "@/lib/stores";

export type StoreState = {
  status: "idle" | "success" | "error";
  message: string;
};

export type StoreInput = {
  id: string;
  name: string;
  phone: string;
  address: string;
};

/**
 * 店舗情報の変更 (管理者のみ)。
 * 店舗名はレシートの先頭に印字されるため、開店前に自店の名前へ変えてもらう。
 */
export async function updateStore(input: StoreInput): Promise<StoreState> {
  if (!(await requireAdmin())) {
    return { status: "error", message: "管理者のみ変更できます" };
  }

  const name = input.name.trim();
  if (!name) return { status: "error", message: "店舗名を入力してください" };
  if (name.length > 50) return { status: "error", message: "店舗名は50文字以内で入力してください" };

  const store = await prisma.store.findUnique({ where: { id: input.id } });
  if (!store) return { status: "error", message: "店舗が見つかりません" };

  await prisma.store.update({
    where: { id: store.id },
    data: {
      name,
      phone: input.phone.trim() || null,
      address: input.address.trim() || null,
    },
  });

  revalidatePath("/settings");
  revalidatePath("/register");
  return { status: "success", message: "店舗情報を保存しました" };
}

/** 設定画面を開いたときに、店舗が1つも無ければ既定の店舗を用意する */
export async function ensureStoreForSettings() {
  return ensureDefaultStore();
}
