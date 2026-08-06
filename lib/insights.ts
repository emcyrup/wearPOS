import {
  customerInsights,
  dailySalesTrend,
  previousRange,
  salesByColorAndSize,
  salesBySeason,
  salesByStaff,
  salesByStore,
  salesSummary,
  topSellingVariants,
  type DateRange,
} from "@/lib/analytics";
import { lowStockItems } from "@/lib/analytics";

/**
 * AI 考察に渡す期間データを組み立てる。
 * ダッシュボードと同じ集計関数を使い、モデルには集計済みの数値だけを渡す
 * (顧客の氏名・連絡先などの個人情報は含めない)。
 */
export async function buildInsightData(range: DateRange) {
  const prev = previousRange(range);

  const [summary, prevSummary, trend, stores, staff, topSkus, mix, seasons, customers, lowStock] =
    await Promise.all([
      salesSummary(range),
      salesSummary(prev),
      dailySalesTrend(range),
      salesByStore(range),
      salesByStaff(range),
      topSellingVariants(range),
      salesByColorAndSize(range),
      salesBySeason(range),
      customerInsights(range),
      lowStockItems(10),
    ]);

  return {
    期間: {
      開始日: range.from.toISOString().slice(0, 10),
      終了日: range.to.toISOString().slice(0, 10),
    },
    今期間: {
      純売上_税込: summary.netSales,
      返品額: summary.returns,
      客数: summary.transactionCount,
      販売点数: summary.itemCount,
      客単価: summary.averageOrderValue,
      一会計あたり点数: Number(summary.unitsPerTransaction.toFixed(2)),
      会員売上比率: Number(summary.memberSalesRatio.toFixed(3)),
      プロパー消化率: Number(summary.properSellThrough.toFixed(3)),
    },
    前同期間: {
      純売上_税込: prevSummary.netSales,
      客数: prevSummary.transactionCount,
      客単価: prevSummary.averageOrderValue,
      プロパー消化率: Number(prevSummary.properSellThrough.toFixed(3)),
    },
    日別推移: trend.map((d) => ({ 日付: d.date, 売上: d.sales, 客数: d.orders })),
    店舗別: stores.map((s) => ({ 店舗: s.storeName, 売上: s.sales, 客数: s.orders })),
    スタッフ別上位: staff.slice(0, 5).map((s) => ({
      名前: s.staffName,
      売上: s.sales,
      客数: s.orders,
      客単価: s.averageOrderValue,
    })),
    売れ筋SKU: topSkus.map((v) => ({
      SKU: v.sku,
      商品: v.productName,
      カラー: v.colorName,
      サイズ: v.sizeName,
      シーズン: v.seasonCode,
      点数: v.quantity,
      売上: v.sales,
    })),
    カラー別販売: mix.colors.map((c) => ({ カラー: c.name, 点数: c.quantity, 売上: c.sales })),
    サイズ別販売: mix.sizes.map((s) => ({ サイズ: s.name, 点数: s.quantity, 売上: s.sales })),
    シーズン別: seasons.map((s) => ({
      シーズン: s.code,
      点数: s.quantity,
      売上: s.sales,
      プロパー率: Number(s.properRate.toFixed(3)),
    })),
    顧客: {
      会員数: customers.totalCustomers,
      期間内新規: customers.newCustomers,
      リピート率: Number(customers.repeatRate.toFixed(3)),
      休眠_90日以上: customers.dormantCustomers,
      LINE連携数: customers.lineLinkedCount,
      ランク分布: Object.fromEntries(customers.rankCounts.map((r) => [r.rank, r.count])),
    },
    安全在庫割れ: lowStock.map((i) => ({
      店舗: i.storeName,
      SKU: i.sku,
      商品: i.productName,
      在庫: i.quantity,
      発注点: i.safetyStock,
    })),
  };
}

export const INSIGHT_SYSTEM_PROMPT = `あなたはアパレル小売に精通した経営分析のパートナーです。店長やスーパーバイザーの壁打ち相手として、POS データに基づく考察と実行可能な打ち手を日本語で返します。

前提知識:
- プロパー消化率 = 値引きなしで売れた点数の割合。高いほど利益体質
- 消化率・シーズン別売上は在庫の持ち方 (追加発注・値下げ判断) に直結する
- 客単価 = 売上 ÷ 会計数。セット率 (一会計あたり点数) とあわせて接客の質を映す
- 休眠 = 90日以上来店のない会員。LINE 連携済みなら低コストで呼び戻せる

振る舞い:
- 必ず与えられたデータの数値を根拠として引用する。データに無いことは推測と明示する
- 結論から書く。最初に要点を2〜3行でまとめ、その後に根拠と打ち手を続ける
- 打ち手は「誰が・何を・いつまでに」の粒度で、明日から動ける具体性で書く
- 数値の単純な読み上げはしない。比較 (前期間・店舗間・シーズン間) から意味を取り出す
- 深刻な数値悪化があれば率直に指摘する。楽観的な取り繕いはしない
- 見出しや箇条書きは使ってよいが、簡潔に。全体で読み切れる長さに収める`;
