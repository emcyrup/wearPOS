"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { runReminders, type ReminderRunResult } from "@/lib/reminders";

const updateSchema = z.object({
  key: z.enum(["PURCHASE_FOLLOW", "REVISIT", "DORMANT", "BIRTHDAY"]),
  enabled: z.boolean(),
  days: z.number().int().min(1).max(730),
});

export type ReminderUpdateResult = { ok: boolean; error?: string };

/** リマインドルールの有効/無効・経過日数を更新する (管理者のみ) */
export async function updateReminderRule(input: unknown): Promise<ReminderUpdateResult> {
  if (!(await requireAdmin())) {
    return { ok: false, error: "管理者のみ変更できます" };
  }
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "入力内容が不正です (日数は1〜730)" };
  }

  await prisma.reminderRule.upsert({
    where: { key: parsed.data.key },
    create: parsed.data,
    update: { enabled: parsed.data.enabled, days: parsed.data.days },
  });

  revalidatePath("/settings");
  return { ok: true };
}

/** リマインドを今すぐ実行する (管理者のみ。動作確認用) */
export async function runRemindersNow(): Promise<{
  ok: boolean;
  results?: ReminderRunResult[];
  error?: string;
}> {
  if (!(await requireAdmin())) {
    return { ok: false, error: "管理者のみ実行できます" };
  }
  const results = await runReminders();
  revalidatePath("/settings");
  return { ok: true, results };
}
