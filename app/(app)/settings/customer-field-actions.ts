"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import {
  CUSTOMER_FIELD_POLICY_KEY,
  parseCustomerFieldPolicy,
  type CustomerFieldPolicy,
} from "@/lib/customer-fields";
import { prisma } from "@/lib/db";

export type CustomerFieldState = { status: "idle" | "success" | "error"; message: string };

const modeSchema = z.enum(["REQUIRED", "OPTIONAL", "HIDDEN"]);

const policySchema = z.object({
  nameMode: z.enum(["FULL", "NICKNAME"]),
  nameRequired: z.boolean(),
  kana: modeSchema,
  phone: modeSchema,
  email: modeSchema,
  birthday: modeSchema,
  gender: modeSchema,
  address: modeSchema,
  addressCityOnly: z.boolean(),
});

/** 顧客登録で集める項目の設定を読む (サーバーコンポーネントから使う) */
export async function getCustomerFieldPolicy(): Promise<CustomerFieldPolicy> {
  const row = await prisma.appSetting.findUnique({ where: { key: CUSTOMER_FIELD_POLICY_KEY } });
  return parseCustomerFieldPolicy(row?.value);
}

/** 顧客登録で集める項目を保存する (管理者のみ) */
export async function updateCustomerFieldPolicy(input: unknown): Promise<CustomerFieldState> {
  if (!(await requireAdmin())) {
    return { status: "error", message: "管理者のみ実行できます" };
  }
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: "入力内容が不正です" };
  }

  const value = JSON.stringify(parsed.data);
  await prisma.appSetting.upsert({
    where: { key: CUSTOMER_FIELD_POLICY_KEY },
    update: { value },
    create: { key: CUSTOMER_FIELD_POLICY_KEY, value },
  });

  revalidatePath("/settings");
  revalidatePath("/customers/new");
  return { status: "success", message: "顧客登録の項目を保存しました" };
}
