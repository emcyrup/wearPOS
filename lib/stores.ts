import { prisma } from "@/lib/db";

/**
 * 店舗マスタ。
 *
 * 伝票・在庫・レシートはすべて店舗にひも付くため、**有効な店舗が最低1つ必要**。
 * 単店舗運用 (MULTI_STORE=false) では画面に店舗の選択肢を出さないので、
 * 1つも無いまま会計しようとすると原因の分かりにくいエラーになる。
 * そのため、必要になった時点で既定の店舗を用意する。
 */
export const DEFAULT_STORE = { code: "S001", name: "本店" };

/**
 * 有効な店舗が1つも無ければ既定の店舗を作る。何度呼んでも増えない。
 * 店舗名は 設定 → 店舗 からいつでも変更できる (レシートに印字される)。
 */
export async function ensureDefaultStore() {
  const active = await prisma.store.findFirst({
    where: { isActive: true },
    orderBy: { code: "asc" },
  });
  if (active) return active;

  // 同じコードの店舗が無効化されていれば、作り直さずに戻す
  return prisma.store.upsert({
    where: { code: DEFAULT_STORE.code },
    update: { isActive: true },
    create: DEFAULT_STORE,
  });
}

/** レジ・在庫・商品登録で選べる店舗。1つも無ければ既定の店舗を用意して返す */
export async function listActiveStores() {
  const stores = await prisma.store.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
  });
  if (stores.length > 0) return stores;
  return [await ensureDefaultStore()];
}
