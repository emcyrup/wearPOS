/**
 * アパレル業務のドメインルール。
 * SKU コードの組み立て、サイズ並び順、シーズン判定、プロパー消化率など。
 */

/** 標準サイズの並び順。数値サイズ(23.0cm 等)はここに無いので別途扱う */
const SIZE_ORDER: Record<string, number> = {
  XXS: 10,
  XS: 20,
  S: 30,
  M: 40,
  L: 50,
  XL: 60,
  XXL: 70,
  "3XL": 80,
  F: 90, // フリーサイズ
  FREE: 90,
  ONE: 90,
};

/**
 * サイズコードから並び順を返す。
 * 未知のコードは数値として解釈を試み、それも無理なら末尾に寄せる。
 */
export function sizeOrderOf(sizeCode: string): number {
  const key = sizeCode.trim().toUpperCase();
  if (key in SIZE_ORDER) return SIZE_ORDER[key];

  const numeric = Number.parseFloat(key.replace(/[^0-9.]/g, ""));
  if (Number.isFinite(numeric)) {
    // 数値サイズ(ウエスト・cm)は標準サイズ帯の後ろに並べる
    return 1000 + numeric * 10;
  }
  return 9999;
}

/**
 * SKU コードを組み立てる: 品番-カラー-サイズ。
 * カラーを指定しない商品もあるため、空の部分は詰める (例: 品番-サイズ)
 */
export function buildSku(styleCode: string, colorCode: string, sizeCode: string): string {
  return [styleCode, colorCode, sizeCode]
    .map((part) => part.trim().toUpperCase().replace(/\s+/g, ""))
    .filter((part) => part !== "")
    .join("-");
}

/**
 * カラーを分けない商品 (小物・雑貨など) の置き換え値。
 * SKU にはカラーの部分を入れず、画面には「指定なし」と表示する
 */
export const NO_COLOR = { code: "NA", name: "指定なし" } as const;

/**
 * 品番を空欄で登録したときに自動採番する形式。
 * `P` + 年月 (YYMM) + `-` + 連番3桁 (例: P2609-001)。
 * 実際の払い出しは lib/style-code.ts で行う
 */
export const AUTO_STYLE_PREFIX = "P";

/** 自動採番される品番の見本 (画面の案内に使う) */
export function autoStyleCodeExample(now = new Date()): string {
  const yymm = `${String(now.getFullYear() % 100).padStart(2, "0")}${String(
    now.getMonth() + 1,
  ).padStart(2, "0")}`;
  return `${AUTO_STYLE_PREFIX}${yymm}-001`;
}

export const SEASON_TERMS = ["SS", "AW", "ALL"] as const;
export type SeasonTerm = (typeof SEASON_TERMS)[number];

export const SEASON_TERM_LABEL: Record<string, string> = {
  SS: "春夏",
  AW: "秋冬",
  ALL: "通年",
};

/** シーズンコードを生成 (2026, "SS" -> "2026SS") */
export function buildSeasonCode(year: number, term: SeasonTerm): string {
  return `${year}${term}`;
}

export type SeasonPhase = "PRE" | "PROPER" | "SALE" | "ENDED";

export const SEASON_PHASE_LABEL: Record<SeasonPhase, string> = {
  PRE: "投入前",
  PROPER: "プロパー",
  SALE: "セール",
  ENDED: "シーズン終了",
};

/**
 * 基準日におけるシーズンの局面を判定する。
 * セール開始日を過ぎていればプロパー期間中でも SALE 扱い。
 */
export function seasonPhase(
  season: { startsOn: Date; endsOn: Date; saleStartsOn: Date | null },
  at: Date = new Date(),
): SeasonPhase {
  if (at < season.startsOn) return "PRE";
  if (at > season.endsOn) return "ENDED";
  if (season.saleStartsOn && at >= season.saleStartsOn) return "SALE";
  return "PROPER";
}

/** 値下げ率 (0〜1)。プロパー価格に対する現在価格の下落幅 */
export function markdownRate(listPrice: number, currentPrice: number): number {
  if (listPrice <= 0) return 0;
  return Math.max(0, (listPrice - currentPrice) / listPrice);
}

/**
 * プロパー消化率。
 * 「プロパー価格のまま売れた点数 / 総販売点数」で、値引きに頼らず売れた割合を示す。
 */
export function properSellThroughRate(
  lines: { quantity: number; unitPrice: number; discount: number; listPriceAtSale: number }[],
): number {
  let total = 0;
  let proper = 0;
  for (const line of lines) {
    total += line.quantity;
    const effectiveUnit = line.unitPrice - (line.quantity > 0 ? line.discount / line.quantity : 0);
    if (line.listPriceAtSale > 0 && effectiveUnit >= line.listPriceAtSale) {
      proper += line.quantity;
    }
  }
  return total === 0 ? 0 : proper / total;
}

/**
 * 消化率 (sell-through)。
 * 販売点数 / (販売点数 + 残在庫) で、投入した在庫がどれだけ捌けたかを示す。
 */
export function sellThroughRate(soldQty: number, onHandQty: number): number {
  const supplied = soldQty + onHandQty;
  return supplied === 0 ? 0 : soldQty / supplied;
}

/** 会員ランク。累計購入金額(税込)で判定する */
export const MEMBER_RANKS = ["REGULAR", "SILVER", "GOLD", "PLATINUM"] as const;
export type MemberRank = (typeof MEMBER_RANKS)[number];

export const RANK_RULES: { rank: MemberRank; minSpent: number; pointRate: number; label: string }[] = [
  { rank: "PLATINUM", minSpent: 500_000, pointRate: 0.1, label: "プラチナ" },
  { rank: "GOLD", minSpent: 200_000, pointRate: 0.07, label: "ゴールド" },
  { rank: "SILVER", minSpent: 50_000, pointRate: 0.05, label: "シルバー" },
  { rank: "REGULAR", minSpent: 0, pointRate: 0.03, label: "レギュラー" },
];

export function rankForSpent(totalSpent: number): MemberRank {
  return RANK_RULES.find((rule) => totalSpent >= rule.minSpent)?.rank ?? "REGULAR";
}

export function pointRateForRank(rank: string): number {
  return RANK_RULES.find((rule) => rule.rank === rank)?.pointRate ?? 0.03;
}

export function rankLabel(rank: string): string {
  return RANK_RULES.find((rule) => rule.rank === rank)?.label ?? rank;
}

/**
 * 付与ポイントを算出する。
 * ポイント利用分には付与しない (二重取り防止) ため、正味の支払額を基準にする。
 */
export function calcEarnedPoints(netPaidAmount: number, rank: string): number {
  if (netPaidAmount <= 0) return 0;
  return Math.floor(netPaidAmount * pointRateForRank(rank));
}

/** タグ文字列 <-> 配列 */
export function parseTags(tags: string | null | undefined): string[] {
  if (!tags) return [];
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function serializeTags(tags: string[]): string | null {
  const cleaned = Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));
  return cleaned.length ? cleaned.join(",") : null;
}

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: "現金",
  CREDIT: "クレジット",
  E_MONEY: "電子マネー",
  QR: "QRコード決済",
  OTHER: "その他",
};

export const MOVEMENT_TYPE_LABEL: Record<string, string> = {
  INBOUND: "入荷",
  SALE: "販売",
  RETURN: "返品",
  TRANSFER_OUT: "移動出庫",
  TRANSFER_IN: "移動入庫",
  ADJUSTMENT: "在庫調整",
  STOCKTAKE: "棚卸",
};

/** 顧客の休眠判定に使う日数 */
export const DORMANT_DAYS = 90;

/** 商品登録で選べる標準カラー */
export const STANDARD_COLORS = [
  { code: "BLK", name: "ブラック", hex: "#1c1c1e" },
  { code: "WHT", name: "ホワイト", hex: "#f4f2ee" },
  { code: "NVY", name: "ネイビー", hex: "#2b3550" },
  { code: "BEG", name: "ベージュ", hex: "#cfbea4" },
  { code: "GRY", name: "グレー", hex: "#9a9a9f" },
  { code: "KHK", name: "カーキ", hex: "#6b6b4b" },
  { code: "PNK", name: "ピンク", hex: "#e2b5b8" },
  { code: "BLU", name: "ブルー", hex: "#4a7ba7" },
  { code: "BRN", name: "ブラウン", hex: "#6d5140" },
  { code: "GRN", name: "グリーン", hex: "#4c7a5a" },
  { code: "RED", name: "レッド", hex: "#b8434a" },
  { code: "YEL", name: "イエロー", hex: "#d8b96a" },
] as const;

/** 商品登録で選べる標準サイズ */
export const STANDARD_SIZES = [
  { code: "XS", name: "XS" },
  { code: "S", name: "S" },
  { code: "M", name: "M" },
  { code: "L", name: "L" },
  { code: "XL", name: "XL" },
  { code: "XXL", name: "XXL" },
  { code: "F", name: "FREE" },
] as const;
