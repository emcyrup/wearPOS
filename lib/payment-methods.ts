import { prisma } from "@/lib/db";

/**
 * レジで選べる支払方法。
 * 組み込みの5種は初回アクセス時に自動で作成し、店舗はそこへ自由に追加できる
 * (ギフト券・商品券・自社ポイントカードなど)。
 */
export type PaymentMethodRow = {
  code: string;
  label: string;
  allowSplit: boolean;
  allowChange: boolean;
  isBuiltin: boolean;
  isActive: boolean;
  sortOrder: number;
};

/** 既存データとの互換のため、この5種は常に存在させる (無効化はできるが削除はできない) */
export const BUILTIN_PAYMENT_METHODS: Omit<PaymentMethodRow, "isBuiltin">[] = [
  { code: "CASH", label: "現金", allowSplit: true, allowChange: true, isActive: true, sortOrder: 0 },
  { code: "CREDIT", label: "クレジット", allowSplit: true, allowChange: false, isActive: true, sortOrder: 1 },
  { code: "E_MONEY", label: "電子マネー", allowSplit: true, allowChange: false, isActive: true, sortOrder: 2 },
  { code: "QR", label: "QRコード決済", allowSplit: true, allowChange: false, isActive: true, sortOrder: 3 },
  { code: "OTHER", label: "その他", allowSplit: true, allowChange: false, isActive: true, sortOrder: 4 },
];

/** 組み込みの支払方法を用意し、表示順に全件返す (無効なものも含む) */
export async function ensurePaymentMethods(): Promise<PaymentMethodRow[]> {
  const existing = await prisma.paymentMethod.findMany();
  const known = new Set(existing.map((row) => row.code));
  const missing = BUILTIN_PAYMENT_METHODS.filter((row) => !known.has(row.code));

  if (missing.length > 0) {
    await prisma.paymentMethod.createMany({
      data: missing.map((row) => ({ ...row, isBuiltin: true })),
      skipDuplicates: true,
    });
  }

  return prisma.paymentMethod.findMany({ orderBy: [{ sortOrder: "asc" }, { code: "asc" }] });
}

/** レジで実際に選べる支払方法 (有効なものだけ) */
export async function activePaymentMethods(): Promise<PaymentMethodRow[]> {
  const all = await ensurePaymentMethods();
  return all.filter((row) => row.isActive);
}

/**
 * コード → 表示名の対応。伝票に残っているが後から削除された支払方法も
 * 「コードそのまま」で表示できるよう、呼び出し側で fallback する。
 */
export async function paymentMethodLabels(): Promise<Record<string, string>> {
  const all = await ensurePaymentMethods();
  return Object.fromEntries(all.map((row) => [row.code, row.label]));
}
