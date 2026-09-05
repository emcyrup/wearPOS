/**
 * データの一括削除 (初期化) の定義。
 * Server Action ("use server") からは関数しか公開できないため、
 * 画面と共有する定数・型はこのモジュールに置く。
 */
export const RESET_TARGETS = [
  {
    key: "sales",
    label: "取引履歴",
    description:
      "伝票・明細と、それに紐づくポイント履歴。会員の累計購入額・来店回数・ポイントもゼロに戻ります",
  },
  {
    key: "inventory",
    label: "在庫と変動履歴",
    description: "在庫数・入出庫の履歴・店舗間移動。商品と SKU は残ります",
  },
  {
    key: "products",
    label: "商品と SKU",
    description: "品番・SKU・価格改定履歴。在庫と取引履歴も一緒に消えます",
  },
  {
    key: "customers",
    label: "顧客とポイント",
    description: "会員情報・ポイント履歴・LINE 連携。取引履歴は残り、非会員の取引として扱われます",
  },
  {
    key: "lineLogs",
    label: "LINE 送受信ログ",
    description: "配信・受信メッセージの記録のみ",
  },
] as const;

export type ResetTargetKey = (typeof RESET_TARGETS)[number]["key"];
export type ResetCounts = Record<ResetTargetKey, number>;

/** 確認フレーズ。これを一字一句入力しないと実行できない */
export const RESET_CONFIRM_PHRASE = "データを削除します";

/** 商品を消すと、その SKU に紐づく在庫・取引明細も必ず消える */
export function expandTargets(targets: ResetTargetKey[]): Set<ResetTargetKey> {
  const wants = new Set<ResetTargetKey>(targets);
  if (wants.has("products")) {
    wants.add("inventory");
    wants.add("sales");
  }
  return wants;
}
