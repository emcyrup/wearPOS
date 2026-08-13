import { ean13CheckDigit } from "@/lib/barcode";
import { prisma } from "@/lib/db";

/** 社内採番用の JAN 企業プレフィックス (デモ用。実運用では GS1 で取得したコードを使う) */
const JAN_PREFIX = "490";

/** "2026-08" → "2608"。形式が不正なら null */
export function yymmOf(yearMonth: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(yearMonth.trim());
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return m[1].slice(2) + m[2];
}

/** 現在の年月を "YYYY-MM" で返す (採番のデフォルト用) */
export function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * 「年月 + 数字5桁」ルールの JAN (EAN-13) を count 件、連番で確保する。
 * 構成: 490 (プレフィックス) + YYMM (ユーザー指定の年月) + NNNNN (自動連番) + チェックデジット
 * 連番は年月ごとに 00001 から始まり、その年月の既存最大値 + 1 から払い出す。
 */
export async function reserveSequentialJan(yearMonth: string, count: number): Promise<string[]> {
  const yymm = yymmOf(yearMonth);
  if (!yymm) throw new Error("採番年月の形式が不正です (例: 2026-08)");

  const prefix = JAN_PREFIX + yymm;
  const last = await prisma.productVariant.findFirst({
    where: { barcode: { startsWith: prefix } },
    orderBy: { barcode: "desc" },
    select: { barcode: true },
  });
  let seq = last?.barcode ? Number.parseInt(last.barcode.slice(prefix.length, prefix.length + 5), 10) : 0;
  if (!Number.isFinite(seq)) seq = 0;

  const codes: string[] = [];
  while (codes.length < count) {
    seq += 1;
    if (seq > 99999) throw new Error(`年月 ${yearMonth} の連番 (5桁) を使い切りました`);
    const body = prefix + String(seq).padStart(5, "0");
    codes.push(body + ean13CheckDigit(body));
  }
  return codes;
}
