"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { serializeTags } from "@/lib/apparel";
import { prisma } from "@/lib/db";
import { issueLinkToken, LINK_TOKEN_TTL_MINUTES, pushLineText } from "@/lib/line";

export type ActionState = { status: "idle" | "success" | "error"; message: string };

export const INITIAL_STATE: ActionState = { status: "idle", message: "" };

/** 店頭で顧客に伝える LINE 連携コードを発行する */
export async function createLineLinkToken(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const customerId = String(formData.get("customerId") ?? "");
  if (!customerId) return { status: "error", message: "顧客が指定されていません" };

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return { status: "error", message: "顧客が見つかりません" };

  const token = await issueLinkToken(customerId);
  revalidatePath(`/customers/${customerId}`);

  return {
    status: "success",
    message: `連携コード: ${token.token} （有効期限 ${LINK_TOKEN_TTL_MINUTES} 分）。このコードを LINE のトークに送信していただくと連携が完了します。`,
  };
}

const messageSchema = z.object({
  customerId: z.string().min(1),
  body: z.string().trim().min(1, "メッセージを入力してください").max(1000, "1000文字以内で入力してください"),
});

/** 顧客の LINE へ個別メッセージを送る */
export async function sendLineMessage(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = messageSchema.safeParse({
    customerId: formData.get("customerId"),
    body: formData.get("body"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "入力を確認してください" };
  }

  const account = await prisma.lineAccount.findUnique({
    where: { customerId: parsed.data.customerId },
  });
  if (!account) return { status: "error", message: "この顧客は LINE 未連携です" };
  if (!account.isFollowing) {
    return { status: "error", message: "友だち解除(ブロック)されているため送信できません" };
  }

  const result = await pushLineText(account.lineUserId, parsed.data.body, {
    customerId: parsed.data.customerId,
    template: "MANUAL",
  });

  revalidatePath(`/customers/${parsed.data.customerId}`);

  return result.sent
    ? { status: "success", message: "LINE に送信しました" }
    : {
        status: "error",
        message: `${result.error ?? "送信に失敗しました"}（送信ログには記録されています）`,
      };
}

const profileSchema = z.object({
  customerId: z.string().min(1),
  note: z.string().max(2000).optional(),
  tags: z.string().max(500).optional(),
});

/** 接客メモ・好みタグを更新する */
export async function updateCustomerProfile(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = profileSchema.safeParse({
    customerId: formData.get("customerId"),
    note: formData.get("note"),
    tags: formData.get("tags"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "入力を確認してください" };
  }

  await prisma.customer.update({
    where: { id: parsed.data.customerId },
    data: {
      note: parsed.data.note?.trim() || null,
      tags: serializeTags((parsed.data.tags ?? "").split(",")),
    },
  });

  revalidatePath(`/customers/${parsed.data.customerId}`);
  return { status: "success", message: "顧客情報を更新しました" };
}

const pointSchema = z.object({
  customerId: z.string().min(1),
  points: z.coerce.number().int().refine((n) => n !== 0, "0 以外を入力してください"),
  note: z.string().max(200).optional(),
});

/** ポイントを手動調整する (お詫び付与・失効処理など) */
export async function adjustPoints(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = pointSchema.safeParse({
    customerId: formData.get("customerId"),
    points: formData.get("points"),
    note: formData.get("note"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "入力を確認してください" };
  }

  const customer = await prisma.customer.findUnique({ where: { id: parsed.data.customerId } });
  if (!customer) return { status: "error", message: "顧客が見つかりません" };

  const balance = customer.points + parsed.data.points;
  if (balance < 0) {
    return { status: "error", message: `残高が不足しています (現在 ${customer.points} pt)` };
  }

  await prisma.$transaction([
    prisma.pointEvent.create({
      data: {
        customerId: customer.id,
        type: "ADJUST",
        points: parsed.data.points,
        balance,
        note: parsed.data.note?.trim() || "手動調整",
      },
    }),
    prisma.customer.update({ where: { id: customer.id }, data: { points: balance } }),
  ]);

  revalidatePath(`/customers/${customer.id}`);
  return { status: "success", message: `ポイントを調整しました (残高 ${balance} pt)` };
}
