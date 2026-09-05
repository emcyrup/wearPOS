"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionUser, requireAdmin } from "@/lib/auth";
import {
  DATA_RESET_ENABLED_KEY,
  expandTargets,
  RESET_CONFIRM_PHRASE,
  RESET_TARGETS,
  type ResetCounts,
  type ResetTargetKey,
} from "@/lib/data-reset";
import { prisma } from "@/lib/db";

/**
 * データの一括削除 (初期化)。
 *
 * テストデータを入れたまま本番運用へ移れない、という運用上の詰まりを解消するための機能。
 * 取り消せない操作なので、
 *   - 管理者のみ
 *   - 削除前に件数をプレビュー
 *   - 確認フレーズの入力
 *   - 実行内容を監査ログに記録
 * の4段構えにしている。
 */

export type DataResetState = {
  status: "idle" | "success" | "error";
  message: string;
};

/** データの初期化が有効になっているか (既定は無効) */
export async function isDataResetEnabled(): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: DATA_RESET_ENABLED_KEY } });
  return row?.value === "true";
}

/** 管理者が明示的に有効化 / 無効化する。実行後は自動で無効へ戻す */
export async function setDataResetEnabled(enabled: boolean): Promise<DataResetState> {
  if (!(await requireAdmin())) {
    return { status: "error", message: "管理者のみ実行できます" };
  }
  const value = enabled ? "true" : "false";
  await prisma.appSetting.upsert({
    where: { key: DATA_RESET_ENABLED_KEY },
    update: { value },
    create: { key: DATA_RESET_ENABLED_KEY, value },
  });
  revalidatePath("/settings");
  revalidatePath("/settings/data-reset");
  return {
    status: "success",
    message: enabled
      ? "データの初期化を有効にしました。作業が終わったら無効に戻してください"
      : "データの初期化を無効にしました",
  };
}

/** 削除対象の件数。画面のプレビューに使う */
export async function countResetTargets(): Promise<ResetCounts | null> {
  if (!(await requireAdmin())) return null;

  const [sales, inventory, products, customers, lineLogs] = await Promise.all([
    prisma.sale.count(),
    prisma.stockMovement.count(),
    prisma.product.count(),
    prisma.customer.count(),
    prisma.lineMessageLog.count(),
  ]);

  return { sales, inventory, products, customers, lineLogs };
}

const resetSchema = z.object({
  targets: z.array(z.enum(RESET_TARGETS.map((t) => t.key) as [ResetTargetKey, ...ResetTargetKey[]])).min(1),
  confirmText: z.string(),
});

export async function resetData(input: unknown): Promise<DataResetState> {
  const admin = await requireAdmin();
  if (!admin) {
    return { status: "error", message: "管理者のみ実行できます" };
  }
  // 既定では無効。使うときだけ管理者が有効化する運用
  if (!(await isDataResetEnabled())) {
    return {
      status: "error",
      message: "データの初期化は無効になっています。実行するには先に有効化してください",
    };
  }

  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: "削除する対象を1つ以上選んでください" };
  }
  const { targets, confirmText } = parsed.data;

  if (confirmText.trim() !== RESET_CONFIRM_PHRASE) {
    return {
      status: "error",
      message: `確認のため「${RESET_CONFIRM_PHRASE}」と入力してください`,
    };
  }

  const wants = expandTargets(targets);

  const deleted: Record<string, number> = {};
  const countOf = (result: { count: number }) => result.count;

  try {
    await prisma.$transaction(async (tx) => {
      // 1. 取引 (明細・ポイント履歴を先に落とす)
      if (wants.has("sales")) {
        deleted.pointEvents = countOf(await tx.pointEvent.deleteMany({ where: { saleId: { not: null } } }));
        deleted.saleLines = countOf(await tx.saleLine.deleteMany({}));
        deleted.sales = countOf(await tx.sale.deleteMany({}));

        // 顧客を残す場合、購入実績が伝票と矛盾しないようゼロに戻す
        if (!wants.has("customers")) {
          await tx.customer.updateMany({
            data: {
              totalSpent: 0,
              visitCount: 0,
              points: 0,
              rank: "REGULAR",
              firstVisitAt: null,
              lastVisitAt: null,
            },
          });
        }
      }

      // 2. 在庫と変動履歴
      if (wants.has("inventory")) {
        deleted.stockTransferLines = countOf(await tx.stockTransferLine.deleteMany({}));
        deleted.stockTransfers = countOf(await tx.stockTransfer.deleteMany({}));
        deleted.stockMovements = countOf(await tx.stockMovement.deleteMany({}));
        deleted.inventory = countOf(await tx.inventory.deleteMany({}));
      }

      // 3. 商品と SKU (価格改定履歴・カスタム項目値は Cascade で消える)
      if (wants.has("products")) {
        deleted.priceChanges = countOf(await tx.priceChange.deleteMany({}));
        deleted.variants = countOf(await tx.productVariant.deleteMany({}));
        deleted.products = countOf(await tx.product.deleteMany({}));
      }

      // 4. 顧客 (ポイント履歴・LINE 連携は Cascade。伝票の customerId は自動で null になる)
      if (wants.has("customers")) {
        deleted.customerPointEvents = countOf(await tx.pointEvent.deleteMany({}));
        deleted.lineMessages = countOf(await tx.lineMessageLog.deleteMany({}));
        deleted.lineLinkTokens = countOf(await tx.lineLinkToken.deleteMany({}));
        deleted.lineAccounts = countOf(await tx.lineAccount.deleteMany({}));
        deleted.customers = countOf(await tx.customer.deleteMany({}));
      }

      // 5. LINE ログのみ
      if (wants.has("lineLogs") && !wants.has("customers")) {
        deleted.lineMessages = countOf(await tx.lineMessageLog.deleteMany({}));
      }

      await tx.auditLog.create({
        data: {
          actorId: admin.uid || null,
          actorName: admin.name,
          action: "DATA_RESET",
          detail: JSON.stringify({ targets: [...wants], deleted }),
        },
      });
    });
  } catch (error) {
    console.error("データ初期化に失敗しました", error);
    return {
      status: "error",
      message: "削除に失敗しました。時間をおいて再度お試しください (データは変更されていません)",
    };
  }

  // 実行できるのは1回だけ。続けて消したいときは、もう一度有効化してもらう
  await prisma.appSetting.upsert({
    where: { key: DATA_RESET_ENABLED_KEY },
    update: { value: "false" },
    create: { key: DATA_RESET_ENABLED_KEY, value: "false" },
  });

  for (const path of ["/", "/sales", "/products", "/inventory", "/customers", "/settings", "/settings/data-reset"]) {
    revalidatePath(path);
  }

  const summary = Object.entries(deleted)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${key}: ${count}`)
    .join(" / ");

  return {
    status: "success",
    message: summary ? `削除しました (${summary})` : "削除対象のデータはありませんでした",
  };
}

/** 直近のデータ初期化の履歴 (設定画面に出す) */
export async function recentDataResets() {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") return [];
  return prisma.auditLog.findMany({
    where: { action: "DATA_RESET" },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
}
