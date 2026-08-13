import type { Prisma } from "@prisma/client";

/**
 * 新しい会員番号 (M+連番) を払い出す。
 * 既存の最大値 + 1。同時登録で一意制約に当たったら attempt を増やして再試行する。
 */
export async function allocateMemberCode(
  tx: Prisma.TransactionClient,
  attempt = 0,
): Promise<string> {
  const latest = await tx.customer.findFirst({
    orderBy: { memberCode: "desc" },
    select: { memberCode: true },
  });
  const nextNumber =
    (latest ? Number.parseInt(latest.memberCode.replace(/\D/g, ""), 10) : 10000) + 1 + attempt;
  return `M${nextNumber}`;
}
