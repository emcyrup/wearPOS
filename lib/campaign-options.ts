/**
 * LINE 一斉配信の選択肢。
 * クライアントコンポーネントからも import するため、DB 依存を持たせない。
 */

export const CAMPAIGN_TARGETS = [
  { key: "dormant", label: "休眠会員 (90日以上未来店)" },
  { key: "gold_up", label: "ゴールド・プラチナ会員" },
  { key: "all", label: "LINE連携済みの全会員" },
] as const;

export const CAMPAIGN_TYPES = [
  { key: "revisit", label: "再来店の呼びかけ" },
  { key: "recommend", label: "おすすめ商品の提案" },
] as const;

export type CampaignTarget = (typeof CAMPAIGN_TARGETS)[number]["key"];
export type CampaignType = (typeof CAMPAIGN_TYPES)[number]["key"];

export type CampaignResult = {
  targeted: number;
  sent: number;
  failed: number;
  /** おすすめ商品が作れず再来店文面で代替した件数 */
  fallback: number;
};
