import { AUTO_STYLE_PREFIX } from "@/lib/apparel";
import { prisma } from "@/lib/db";

/**
 * 品番の自動採番。
 *
 * 品番を決めていないお店・商品もあるため、空欄のまま登録できるようにしている。
 * 形式は `P` + 年月 (YYMM) + `-` + 連番3桁 (例: P2609-001)。
 * 自店で採番した品番だと分かる形にしつつ、既存の品番 (26SS-CT-001 など) とはぶつからない。
 */

function yymmOf(date: Date): string {
  return `${String(date.getFullYear() % 100).padStart(2, "0")}${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * 未使用の品番を必要な数だけ払い出す。
 * 同じ年月の中で連番を進め、既に使われている品番は飛ばす。
 */
export async function reserveAutoStyleCodes(count: number, now = new Date()): Promise<string[]> {
  if (count <= 0) return [];

  const prefix = `${AUTO_STYLE_PREFIX}${yymmOf(now)}-`;
  // 同じ形の品番を手入力していることもあるため、使用済みをまとめて読んでから飛ばす
  const used = new Set(
    (
      await prisma.product.findMany({
        where: { styleCode: { startsWith: prefix } },
        select: { styleCode: true },
      })
    ).map((product) => product.styleCode),
  );

  const codes: string[] = [];
  let seq = 0;
  while (codes.length < count) {
    seq += 1;
    if (seq > 99999) throw new Error("品番の自動採番が上限に達しました。品番を入力してください");
    const code = prefix + String(seq).padStart(3, "0");
    if (!used.has(code)) codes.push(code);
  }
  return codes;
}
