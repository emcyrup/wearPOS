import { DORMANT_DAYS, rankLabel } from "@/lib/apparel";
import type { CampaignResult, CampaignTarget, CampaignType } from "@/lib/campaign-options";
import { prisma } from "@/lib/db";
import { daysSince, formatYen, fullName } from "@/lib/format";
import { pushLineText } from "@/lib/line";

/**
 * 再来店促進・おすすめ商品の LINE メッセージ。
 * 文面は購買履歴 (よく買うサイズ・カラー) と在庫から個別に組み立てる。
 */

type Tendency = {
  sizeCode: string | null;
  sizeName: string | null;
  colorCode: string | null;
  colorName: string | null;
  boughtProductIds: string[];
  boughtVariantIds: string[];
};

/** 購買履歴から、よく買うサイズ・カラーを集計する */
async function purchaseTendency(customerId: string): Promise<Tendency> {
  // 手入力商品 (variant なし) は好み推定の対象外
  const allLines = await prisma.saleLine.findMany({
    where: { sale: { customerId, type: "SALE" } },
    include: { variant: true },
  });
  const lines = allLines.filter(
    (line): line is (typeof allLines)[number] & { variant: NonNullable<(typeof allLines)[number]["variant"]>; variantId: string } =>
      line.variant !== null,
  );

  const tally = (key: (line: (typeof lines)[number]) => string) => {
    const counts = new Map<string, number>();
    for (const line of lines) {
      counts.set(key(line), (counts.get(key(line)) ?? 0) + line.quantity);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  };

  const topSize = tally((line) => `${line.variant.sizeCode}\t${line.variant.sizeName}`)[0]?.[0];
  const topColor = tally((line) => `${line.variant.colorCode}\t${line.variant.colorName}`)[0]?.[0];
  const [sizeCode, sizeName] = topSize?.split("\t") ?? [null, null];
  const [colorCode, colorName] = topColor?.split("\t") ?? [null, null];

  return {
    sizeCode,
    sizeName,
    colorCode,
    colorName,
    boughtProductIds: [...new Set(lines.map((line) => line.variant.productId))],
    boughtVariantIds: [...new Set(lines.map((line) => line.variantId))],
  };
}

/**
 * おすすめ商品を選ぶ。条件を段階的に緩めながら在庫のある SKU を探す:
 * 1. よく買うサイズ × 未購入の商品
 * 2. よく買うサイズ × 購入済み商品の色違い (SKU 未購入)
 * 3. サイズを問わず未購入の商品
 */
async function pickRecommendations(tendency: Tendency, count = 3) {
  const tiers = [
    {
      ...(tendency.sizeCode ? { sizeCode: tendency.sizeCode } : {}),
      productId: { notIn: tendency.boughtProductIds },
    },
    {
      ...(tendency.sizeCode ? { sizeCode: tendency.sizeCode } : {}),
      id: { notIn: tendency.boughtVariantIds },
    },
    { productId: { notIn: tendency.boughtProductIds } },
  ];

  for (const tier of tiers) {
    const variants = await prisma.productVariant.findMany({
      where: {
        isActive: true,
        inventory: { some: { quantity: { gt: 0 } } },
        ...tier,
      },
      include: { product: { include: { season: true } } },
    });
    if (variants.length === 0) continue;

    // よく買うカラーを優先し、次に新しいシーズンを優先する
    const sorted = variants.sort((a, b) => {
      const colorScore =
        Number(b.colorCode === tendency.colorCode) - Number(a.colorCode === tendency.colorCode);
      if (colorScore !== 0) return colorScore;
      return b.product.season.year - a.product.season.year;
    });

    const picked: typeof sorted = [];
    const seenProducts = new Set<string>();
    for (const variant of sorted) {
      if (seenProducts.has(variant.productId)) continue;
      seenProducts.add(variant.productId);
      picked.push(variant);
      if (picked.length >= count) break;
    }
    return picked;
  }
  return [];
}

/** 再来店促進メッセージの下書き */
export async function buildRevisitDraft(customerId: string): Promise<string | null> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: { store: true },
  });
  if (!customer) return null;

  const since = daysSince(customer.lastVisitAt);
  const storeName = customer.store?.name ?? "当店";

  const opening =
    since !== null && since >= DORMANT_DAYS
      ? `前回のご来店から ${since} 日ほど経ちました。お元気でお過ごしでしょうか。`
      : "いつも当店をご利用いただきありがとうございます。";

  return [
    `${fullName(customer)} 様`,
    "",
    opening,
    `${storeName}では新しい商品が続々と入荷しています。`,
    "",
    `現在のポイント残高は ${customer.points.toLocaleString("ja-JP")} pt (${rankLabel(customer.rank)}会員) です。`,
    "次回のお買い物からご利用いただけます。",
    "",
    "スタッフ一同、ご来店を心よりお待ちしております。",
  ].join("\n");
}

/** おすすめ商品メッセージの下書き。提案できる商品がなければ null */
export async function buildRecommendDraft(customerId: string): Promise<string | null> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: { store: true },
  });
  if (!customer) return null;

  const tendency = await purchaseTendency(customerId);
  const picks = await pickRecommendations(tendency);
  if (picks.length === 0) return null;

  const intro =
    tendency.sizeName && tendency.colorName
      ? `${tendency.colorName} / ${tendency.sizeName} をよくお選びいただいているお客様に、おすすめの商品をご紹介します。`
      : "おすすめの新着商品をご紹介します。";

  const items = picks.map((variant) => {
    const price = variant.priceOverride ?? variant.product.currentPrice;
    return `・${variant.product.name} (${variant.colorName}/${variant.sizeName}) ${formatYen(price)}+税`;
  });

  return [
    `${fullName(customer)} 様`,
    "",
    "いつもご利用いただきありがとうございます。",
    intro,
    "",
    ...items,
    "",
    `${customer.store?.name ?? "店頭"}にてお取り置きもできます。お気軽にご返信ください。`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// 一斉配信 (キャンペーン)
// ---------------------------------------------------------------------------

export type { CampaignResult, CampaignTarget, CampaignType } from "@/lib/campaign-options";

/** 1回の一斉配信で送る上限 (実行時間と誤操作の保険) */
export const CAMPAIGN_MAX_RECIPIENTS = 200;

/** 配信対象 (LINE 連携済み・ブロックされていない顧客) を返す */
export async function campaignRecipients(target: CampaignTarget) {
  const dormantBefore = new Date(Date.now() - DORMANT_DAYS * 86_400_000);
  return prisma.customer.findMany({
    where: {
      isActive: true,
      // 「通知オフ」の顧客には一斉配信も送らない
      reminderOptOut: false,
      lineAccount: { isFollowing: true },
      ...(target === "dormant"
        ? { OR: [{ lastVisitAt: { lt: dormantBefore } }, { lastVisitAt: null }] }
        : {}),
      ...(target === "gold_up" ? { rank: { in: ["GOLD", "PLATINUM"] } } : {}),
    },
    include: { lineAccount: true },
    orderBy: { memberCode: "asc" },
    take: CAMPAIGN_MAX_RECIPIENTS,
  });
}

/**
 * 一斉配信を実行する。1通ずつ個別の文面を組み立てて送る。
 * おすすめ商品が選べない顧客には再来店文面を送る。
 */
export async function runCampaign(
  target: CampaignTarget,
  type: CampaignType,
): Promise<CampaignResult> {
  const recipients = await campaignRecipients(target);
  const result: CampaignResult = { targeted: recipients.length, sent: 0, failed: 0, fallback: 0 };

  for (const customer of recipients) {
    if (!customer.lineAccount) continue;

    let body: string | null = null;
    if (type === "recommend") {
      body = await buildRecommendDraft(customer.id);
      if (!body) {
        body = await buildRevisitDraft(customer.id);
        result.fallback += 1;
      }
    } else {
      body = await buildRevisitDraft(customer.id);
    }
    if (!body) {
      result.failed += 1;
      continue;
    }

    const push = await pushLineText(customer.lineAccount.lineUserId, body, {
      customerId: customer.id,
      template: type === "recommend" ? "RECOMMEND" : "REVISIT",
    });
    if (push.sent) {
      result.sent += 1;
    } else {
      result.failed += 1;
    }
  }

  return result;
}
