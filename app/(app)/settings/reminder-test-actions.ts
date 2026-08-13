"use server";

import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { pushLineText } from "@/lib/line";
import { buildReminderPreview, type ReminderRuleKey } from "@/lib/reminders";

const ruleKeySchema = z.enum(["PURCHASE_FOLLOW", "REVISIT", "DORMANT", "BIRTHDAY"]);

export type TestCustomer = {
  id: string;
  memberCode: string;
  name: string;
  lineLinked: boolean;
  lineFollowing: boolean;
  lastVisitAt: string | null;
};

/** テスト対象の顧客を検索する (管理者のみ)。LINE 連携済みを優先して返す */
export async function searchTestCustomers(query: string): Promise<TestCustomer[]> {
  if (!(await requireAdmin())) return [];
  const trimmed = query.trim();

  const customers = await prisma.customer.findMany({
    where: {
      isActive: true,
      ...(trimmed
        ? {
            OR: [
              { memberCode: { contains: trimmed, mode: "insensitive" } },
              { lastName: { contains: trimmed } },
              { firstName: { contains: trimmed } },
              { lastNameKana: { contains: trimmed } },
            ],
          }
        : { lineAccount: { isFollowing: true } }),
    },
    include: { lineAccount: true },
    orderBy: [{ lastVisitAt: "desc" }],
    take: 10,
  });

  return customers.map((customer) => ({
    id: customer.id,
    memberCode: customer.memberCode,
    name: `${customer.lastName} ${customer.firstName}`.trim(),
    lineLinked: Boolean(customer.lineAccount),
    lineFollowing: customer.lineAccount?.isFollowing ?? false,
    lastVisitAt: customer.lastVisitAt ? customer.lastVisitAt.toISOString().slice(0, 10) : null,
  }));
}

export type PreviewResult = { ok: boolean; body?: string; error?: string };

/** 指定ルール × 顧客の文面を組み立てる (送信・記録はしない) */
export async function previewReminderMessage(input: {
  key: string;
  customerId: string;
}): Promise<PreviewResult> {
  if (!(await requireAdmin())) return { ok: false, error: "管理者のみ実行できます" };
  const key = ruleKeySchema.safeParse(input.key);
  if (!key.success) return { ok: false, error: "ルールの指定が不正です" };

  const body = await buildReminderPreview(key.data as ReminderRuleKey, input.customerId);
  return body
    ? { ok: true, body }
    : { ok: false, error: "文面を作成できませんでした (顧客が見つからないか、提案できる商品がありません)" };
}

export type TestSendResult = { ok: boolean; sent?: boolean; message?: string; error?: string };

/**
 * テスト送信。実際にその顧客の LINE へ送る。
 * テンプレートは REMINDER_TEST 固定なので、本番リマインドの二重送信判定には影響しない。
 */
export async function sendTestReminder(input: {
  key: string;
  customerId: string;
}): Promise<TestSendResult> {
  if (!(await requireAdmin())) return { ok: false, error: "管理者のみ実行できます" };
  const key = ruleKeySchema.safeParse(input.key);
  if (!key.success) return { ok: false, error: "ルールの指定が不正です" };

  const account = await prisma.lineAccount.findUnique({
    where: { customerId: input.customerId },
  });
  if (!account) return { ok: false, error: "この顧客は LINE 未連携のため送信できません" };
  if (!account.isFollowing) {
    return { ok: false, error: "友だち解除 (ブロック) されているため送信できません" };
  }

  const body = await buildReminderPreview(key.data as ReminderRuleKey, input.customerId);
  if (!body) return { ok: false, error: "文面を作成できませんでした" };

  const result = await pushLineText(account.lineUserId, `【テスト配信】\n${body}`, {
    customerId: input.customerId,
    template: "REMINDER_TEST",
  });

  return result.sent
    ? { ok: true, sent: true, message: "LINE にテスト送信しました" }
    : {
        ok: true,
        sent: false,
        message: `送信はスキップされました (${result.error ?? "送信無効"})。送信ログには記録されています`,
      };
}
