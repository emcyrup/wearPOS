"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { fullName } from "@/lib/format";
import { fetchLineProfile, pushLineText, registerCustomerFromLine } from "@/lib/line";
import { signMemberCardToken, verifySignupToken } from "@/lib/session";

const signupSchema = z.object({
  token: z.string().min(1),
  lastName: z.string().trim().min(1, "姓を入力してください").max(30),
  firstName: z.string().trim().max(30).default(""),
  lastNameKana: z.string().trim().max(30).default(""),
  firstNameKana: z.string().trim().max(30).default(""),
  phone: z
    .string()
    .trim()
    .max(20)
    .regex(/^[0-9+\-() ]*$/, "電話番号は数字とハイフンで入力してください")
    .default(""),
  email: z.string().trim().max(100).email("メールアドレスの形式が正しくありません").or(z.literal("")).default(""),
  birthday: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .or(z.literal(""))
    .default(""),
  gender: z.enum(["FEMALE", "MALE", "OTHER", "UNKNOWN"]).default("UNKNOWN"),
});

export type SignupResult =
  | { ok: true; memberCode: string; name: string; cardUrl: string; alreadyRegistered: boolean }
  | { ok: false; error: string };

/**
 * LINE の登録フォームからの新規会員登録。
 * トークン (署名付き LINE ユーザー ID) が正当な場合のみ受け付ける。
 */
export async function submitSignup(input: unknown): Promise<SignupResult> {
  const parsed = signupSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力内容を確認してください",
    };
  }

  const lineUserId = await verifySignupToken(parsed.data.token);
  if (!lineUserId) {
    return { ok: false, error: "リンクが無効です。LINE のトークから開き直してください" };
  }

  // 二重送信・登録済みリンクの再利用は既存の登録を返す
  const existing = await prisma.lineAccount.findUnique({
    where: { lineUserId },
    include: { customer: true },
  });
  if (existing) {
    return {
      ok: true,
      memberCode: existing.customer.memberCode,
      name: fullName(existing.customer),
      cardUrl: `/card/${await signMemberCardToken(existing.customerId)}`,
      alreadyRegistered: true,
    };
  }

  const profile = await fetchLineProfile(lineUserId);
  const customer = await registerCustomerFromLine(
    lineUserId,
    {
      lastName: parsed.data.lastName,
      firstName: parsed.data.firstName,
      lastNameKana: parsed.data.lastNameKana,
      firstNameKana: parsed.data.firstNameKana,
      phone: parsed.data.phone,
      email: parsed.data.email,
      birthday: parsed.data.birthday || undefined,
      gender: parsed.data.gender,
    },
    profile,
  );

  const cardToken = await signMemberCardToken(customer.id);

  // LINE のトークにも完了メッセージと会員証を届けておく (送れない環境ではログのみ)
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host") ?? "";
  const proto = headerStore.get("x-forwarded-proto") ?? "https";
  const origin = process.env.APP_URL ?? (host ? `${proto}://${host}` : "");
  await pushLineText(
    lineUserId,
    [
      `${fullName(customer)} 様、会員登録が完了しました🎉`,
      `会員番号: ${customer.memberCode}`,
      "",
      "デジタル会員証はこちらです。お会計の際にレジでご提示ください。",
      `${origin}/card/${cardToken}`,
      "",
      "「ポイント」「履歴」「会員証」と送信するといつでも確認できます。",
    ].join("\n"),
    { customerId: customer.id, template: "SIGNUP_WELCOME" },
  );

  return {
    ok: true,
    memberCode: customer.memberCode,
    name: fullName(customer),
    cardUrl: `/card/${cardToken}`,
    alreadyRegistered: false,
  };
}
