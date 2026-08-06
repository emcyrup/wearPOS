"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionUser } from "@/lib/auth";
import { DASHBOARD_SECTION_KEYS, type DashboardSectionKey } from "@/lib/dashboard";
import { prisma } from "@/lib/db";

const hiddenSchema = z
  .array(z.enum(DASHBOARD_SECTION_KEYS as [DashboardSectionKey, ...DashboardSectionKey[]]))
  .max(DASHBOARD_SECTION_KEYS.length);

export type SaveSectionsResult = { ok: boolean; error?: string };

/** ダッシュボードで非表示にするセクションを保存する (ユーザーごと) */
export async function saveHiddenSections(input: unknown): Promise<SaveSectionsResult> {
  const user = await getSessionUser();
  if (!user?.uid) {
    return { ok: false, error: "ログインが必要です" };
  }

  const parsed = hiddenSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "保存内容が不正です" };
  }

  await prisma.appUser.update({
    where: { id: user.uid },
    data: { dashboardHidden: parsed.data },
  });

  revalidatePath("/");
  return { ok: true };
}
