/** ダッシュボードの表示セクション。ユーザーごとに表示/非表示を選べる */
export const DASHBOARD_SECTIONS = [
  { key: "kpi", label: "KPIカード (売上・客数など)" },
  { key: "trend", label: "売上推移" },
  { key: "ai", label: "AI考察 (壁打ち)" },
  { key: "customers", label: "顧客サマリ" },
  { key: "mix", label: "カラー別 / サイズ別 構成" },
  { key: "topSku", label: "売れ筋 SKU" },
  { key: "season", label: "シーズン別 売上" },
  { key: "store", label: "店舗別 売上" },
  { key: "staffPerf", label: "スタッフ別 実績" },
  { key: "lowStock", label: "在庫アラート" },
] as const;

export type DashboardSectionKey = (typeof DASHBOARD_SECTIONS)[number]["key"];

export const DASHBOARD_SECTION_KEYS = DASHBOARD_SECTIONS.map((s) => s.key);
