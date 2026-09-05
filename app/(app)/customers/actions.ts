"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { serializeTags } from "@/lib/apparel";
import {
  buildRecommendDraft,
  buildRevisitDraft,
  campaignRecipients,
  runCampaign,
} from "@/lib/campaign";
import {
  CAMPAIGN_TARGETS,
  CAMPAIGN_TYPES,
  type CampaignResult,
  type CampaignTarget,
  type CampaignType,
} from "@/lib/campaign-options";
import { prisma } from "@/lib/db";
import { issueLinkToken, LINK_TOKEN_TTL_MINUTES, pushLineText } from "@/lib/line";
import { allocateMemberCode } from "@/lib/member-code";

// "use server" ファイルは async 関数以外を export できないため、
// ActionState の初期値は使う側 (components/customer-forms.tsx) で定義する
export type ActionState = { status: "idle" | "success" | "error"; message: string };

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

// ---------------------------------------------------------------------------
// 再来店・おすすめ商品メッセージ
// ---------------------------------------------------------------------------

export type DraftResult = { ok: boolean; draft?: string; error?: string };

/** 再来店促進メッセージの下書きを作る (送信はしない) */
export async function draftRevisitMessage(customerId: string): Promise<DraftResult> {
  const draft = await buildRevisitDraft(customerId);
  return draft ? { ok: true, draft } : { ok: false, error: "顧客が見つかりません" };
}

/** おすすめ商品メッセージの下書きを作る (送信はしない) */
export async function draftRecommendMessage(customerId: string): Promise<DraftResult> {
  const exists = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!exists) return { ok: false, error: "顧客が見つかりません" };
  const draft = await buildRecommendDraft(customerId);
  return draft
    ? { ok: true, draft }
    : { ok: false, error: "提案できる在庫商品が見つかりませんでした (購入済み・在庫切れを除外しています)" };
}

const campaignSchema = z.object({
  target: z.enum(CAMPAIGN_TARGETS.map((t) => t.key) as [CampaignTarget, ...CampaignTarget[]]),
  type: z.enum(CAMPAIGN_TYPES.map((t) => t.key) as [CampaignType, ...CampaignType[]]),
});

/** 一斉配信の対象人数を確認する */
export async function previewCampaign(input: unknown): Promise<{ ok: boolean; count?: number; error?: string }> {
  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "対象の指定が不正です" };
  const recipients = await campaignRecipients(parsed.data.target);
  return { ok: true, count: recipients.length };
}

/** 一斉配信を実行する。1通ずつ購買傾向に合わせた文面を組み立てて送る */
export async function sendCampaign(
  input: unknown,
): Promise<{ ok: boolean; result?: CampaignResult; error?: string }> {
  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "対象の指定が不正です" };

  const result = await runCampaign(parsed.data.target, parsed.data.type);
  revalidatePath("/customers");
  return { ok: true, result };
}

const reminderSettingsSchema = z.object({
  customerId: z.string().min(1),
  /** true なら全ルール停止 */
  optOut: z.boolean(),
  /** ルール単位で停止するキー */
  disabledKeys: z
    .array(z.enum(["PURCHASE_FOLLOW", "REVISIT", "DORMANT", "BIRTHDAY"]))
    .max(10),
});

/** この顧客への自動リマインド設定 (全停止 + ルール単位の停止) を保存する */
export async function saveCustomerReminderSettings(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = reminderSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "設定内容が不正です" };

  const customer = await prisma.customer.findUnique({ where: { id: parsed.data.customerId } });
  if (!customer) return { ok: false, error: "顧客が見つかりません" };

  await prisma.customer.update({
    where: { id: customer.id },
    data: {
      reminderOptOut: parsed.data.optOut,
      reminderDisabledKeys: parsed.data.disabledKeys,
    },
  });

  revalidatePath(`/customers/${customer.id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 顧客の新規追加 / 削除 / LINE 連携解除
// ---------------------------------------------------------------------------

const createCustomerSchema = z.object({
  lastName: z.string().trim().min(1).max(30),
  firstName: z.string().trim().max(30),
  lastNameKana: z.string().trim().max(30),
  firstNameKana: z.string().trim().max(30),
  phone: z.string().trim().max(20),
  email: z.string().trim().max(100),
  /** YYYY-MM-DD。空文字なら未登録 */
  birthday: z.string().trim(),
  gender: z.enum(["", "FEMALE", "MALE", "OTHER", "UNKNOWN"]),
  /** 郵便番号・住所。設定で「集めない」にしていれば空で届く */
  postalCode: z.string().trim().max(10).default(""),
  address: z.string().trim().max(200).default(""),
  /** 担当店舗。空文字なら未設定 */
  storeId: z.string().trim(),
});

export type CreateCustomerResult =
  | { ok: true; customerId: string; memberCode: string }
  | { ok: false; error: string };

/** 店頭・電話などで聞き取った情報から顧客を新規登録する (会員番号は自動採番) */
export async function createCustomer(input: unknown): Promise<CreateCustomerResult> {
  const parsed = createCustomerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "入力内容を確認してください (お名前は必須です)" };
  }
  if (parsed.data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.data.email)) {
    return { ok: false, error: "メールアドレスの形式が正しくありません" };
  }
  const birthday = parsed.data.birthday ? new Date(`${parsed.data.birthday}T00:00:00`) : null;
  if (birthday && Number.isNaN(birthday.getTime())) {
    return { ok: false, error: "誕生日の形式が正しくありません" };
  }
  if (parsed.data.storeId) {
    const store = await prisma.store.findUnique({ where: { id: parsed.data.storeId } });
    if (!store) return { ok: false, error: "店舗が見つかりません" };
  }

  // 会員番号の同時払い出しで一意制約に当たったときだけやり直す
  for (let attempt = 0; ; attempt++) {
    try {
      const customer = await prisma.$transaction(async (tx) =>
        tx.customer.create({
          data: {
            memberCode: await allocateMemberCode(tx, attempt),
            lastName: parsed.data.lastName,
            firstName: parsed.data.firstName,
            lastNameKana: parsed.data.lastNameKana || null,
            firstNameKana: parsed.data.firstNameKana || null,
            phone: parsed.data.phone || null,
            email: parsed.data.email || null,
            birthday,
            gender: parsed.data.gender || null,
            postalCode: parsed.data.postalCode || null,
            address: parsed.data.address || null,
            storeId: parsed.data.storeId || null,
          },
        }),
      );
      revalidatePath("/customers");
      return { ok: true, customerId: customer.id, memberCode: customer.memberCode };
    } catch (error) {
      if (attempt >= 3) {
        console.error("顧客の新規登録に失敗しました", error);
        return { ok: false, error: "顧客の登録に失敗しました。時間をおいて再度お試しください。" };
      }
    }
  }
}

/**
 * 顧客の削除。
 * 購入履歴のある顧客は取引の記録を守るため削除ではなく無効化し、LINE 連携も解除する。
 * 履歴のない顧客は完全に削除する。
 */
export async function deleteCustomer(customerId: string): Promise<ActionState> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: { _count: { select: { sales: true } } },
  });
  if (!customer) return { status: "error", message: "顧客が見つかりません" };

  if (customer._count.sales > 0) {
    await prisma.$transaction([
      prisma.lineAccount.deleteMany({ where: { customerId } }),
      prisma.lineLinkToken.deleteMany({ where: { customerId } }),
      prisma.customer.update({ where: { id: customerId }, data: { isActive: false } }),
    ]);
    revalidatePath("/customers");
    return {
      status: "success",
      message: `${customer.lastName} ${customer.firstName} 様には購入履歴があるため、削除の代わりに無効化しました (一覧や配信対象から外れます)`,
    };
  }

  // 履歴なし: ポイントイベント・LINE 連携ごと完全削除 (スキーマの Cascade に任せる)
  await prisma.customer.delete({ where: { id: customerId } });
  revalidatePath("/customers");
  return {
    status: "success",
    message: `${customer.lastName} ${customer.firstName} 様を削除しました`,
  };
}

/** 店側からの LINE 連携解除。お客様の LINE アカウントとの紐付けを外す */
export async function unlinkCustomerLine(customerId: string): Promise<ActionState> {
  const account = await prisma.lineAccount.findUnique({ where: { customerId } });
  if (!account) return { status: "error", message: "この顧客は LINE 連携されていません" };

  await prisma.lineAccount.delete({ where: { customerId } });
  revalidatePath(`/customers/${customerId}`);
  return {
    status: "success",
    message: "LINE 連携を解除しました。再連携するには連携コードを発行してください。",
  };
}
