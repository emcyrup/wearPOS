import { rankLabel } from "@/lib/apparel";
import { buildRecommendDraft, buildRevisitDraft } from "@/lib/campaign";
import { prisma } from "@/lib/db";
import { fullName } from "@/lib/format";
import { pushLineText } from "@/lib/line";

/**
 * LINE 自動リマインド。
 * 店舗全体のルール (ReminderRule) に従い、条件を満たした顧客へ自動で送信する。
 * 実行は 1 日 1 回 (Vercel Cron → /api/reminders/run) を想定。
 * 顧客ごとの停止は Customer.reminderOptOut。
 */

export type ReminderRuleKey = "PURCHASE_FOLLOW" | "REVISIT" | "DORMANT" | "BIRTHDAY";

export type ReminderRuleDef = {
  key: ReminderRuleKey;
  label: string;
  /** days を埋め込んだ説明文を返す */
  describe: (days: number) => string;
  defaultDays: number;
  /** 経過日数を編集できるか */
  daysEditable: boolean;
};

export const REMINDER_RULE_DEFS: ReminderRuleDef[] = [
  {
    key: "PURCHASE_FOLLOW",
    label: "お買い上げ後フォロー",
    describe: (days) =>
      `ご購入の${days}日後 10:00｜着心地とお手入れのご案内。1回のご来店につき1通まで`,
    defaultDays: 7,
    daysEditable: true,
  },
  {
    key: "REVISIT",
    label: "再来店のご案内",
    describe: (days) =>
      `最終来店から${days}日後 10:00｜よく買うサイズ・カラーに合わせた新作・おすすめ商品を提案。1回のご来店につき1通まで`,
    defaultDays: 30,
    daysEditable: true,
  },
  {
    key: "DORMANT",
    label: "休眠フォロー",
    describe: (days) =>
      `最終来店から${days}日 10:00｜同じ方へは${days}日に1回まで・ポイント残高のご案内つき`,
    defaultDays: 90,
    daysEditable: true,
  },
  {
    key: "BIRTHDAY",
    label: "誕生日メッセージ",
    describe: () => "お誕生日当日 10:00｜お祝いと特典のご案内 (年1回)",
    defaultDays: 365,
    daysEditable: false,
  },
];

/** ルール設定を読み込む。未作成のルールは既定値で作る */
export async function ensureReminderRules() {
  await prisma.reminderRule.createMany({
    data: REMINDER_RULE_DEFS.map((def) => ({
      key: def.key,
      // 自動配信はまず全体像を確認してから有効化してもらう
      enabled: false,
      days: def.defaultDays,
    })),
    skipDuplicates: true,
  });
  const rules = await prisma.reminderRule.findMany();
  return REMINDER_RULE_DEFS.map((def) => ({
    def,
    rule: rules.find((rule) => rule.key === def.key)!,
  }));
}

// ---------------------------------------------------------------------------
// 文面 (アパレル向け)
// ---------------------------------------------------------------------------

async function buildPurchaseFollowMessage(customerId: string): Promise<string | null> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      store: true,
      sales: {
        where: { type: "SALE" },
        orderBy: { soldAt: "desc" },
        take: 1,
        include: { lines: { include: { variant: { include: { product: true } } } } },
      },
    },
  });
  if (!customer) return null;

  const lastSale = customer.sales[0];
  const items = lastSale?.lines.slice(0, 2).map((line) => line.variant.product.name) ?? [];
  const itemText =
    items.length > 0 ? `お求めいただいた「${items.join("」「")}」` : "お求めいただいたアイテム";

  return [
    `${fullName(customer)} 様`,
    "",
    "先日はご来店いただきありがとうございました。",
    `${itemText}の着心地はいかがでしょうか。`,
    "",
    "サイズ調整・お手入れ方法・コーディネートのご相談は、このトークにご返信いただければスタッフがお答えします。",
    `${customer.store?.name ?? "店頭"}でのお直しのご相談も承っています。`,
  ].join("\n");
}

async function buildBirthdayMessage(customerId: string): Promise<string | null> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: { store: true },
  });
  if (!customer) return null;

  return [
    `${fullName(customer)} 様`,
    "",
    "お誕生日おめでとうございます🎉",
    `いつも${customer.store?.name ?? "当店"}をご利用いただきありがとうございます。`,
    "",
    `ただいま${rankLabel(customer.rank)}会員特典として、お誕生日月のお買い物をスタッフが特別にご案内いたします。この画面をレジでご提示ください。`,
    `現在のポイント残高は ${customer.points.toLocaleString("ja-JP")} pt です。あわせてご利用いただけます。`,
    "",
    "素敵な一年になりますように。ご来店を心よりお待ちしております。",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------

export type ReminderRunResult = {
  key: ReminderRuleKey;
  label: string;
  enabled: boolean;
  targeted: number;
  sent: number;
  failed: number;
};

/** 「この日数だけ過去」の 0時0分を返す */
function daysAgoStart(days: number, now: Date): Date {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  return date;
}

/** リマインド対象の基本条件 (LINE 連携済み・ブロックなし・停止していない) */
const BASE_WHERE = {
  isActive: true,
  reminderOptOut: false,
  lineAccount: { isFollowing: true },
} as const;

/** テンプレート名 */
const templateOf = (key: ReminderRuleKey) => `REMINDER_${key}`;

/**
 * 全ルールを評価して送信する。
 * 二重送信はテンプレートごとの送信ログ (LineMessageLog) で防ぐ:
 * - PURCHASE_FOLLOW / REVISIT: 最終来店より後に送っていなければ1通 (来店サイクルごとに1回)
 * - DORMANT: 直近 days 日以内に送っていなければ1通 (days 日ごとに再送)
 * - BIRTHDAY: 誕生日当日、直近300日以内に送っていなければ1通 (年1回)
 */
export async function runReminders(now = new Date()): Promise<ReminderRunResult[]> {
  const rules = await ensureReminderRules();
  const results: ReminderRunResult[] = [];

  for (const { def, rule } of rules) {
    const result: ReminderRunResult = {
      key: def.key,
      label: def.label,
      enabled: rule.enabled,
      targeted: 0,
      sent: 0,
      failed: 0,
    };
    results.push(result);
    if (!rule.enabled) continue;

    // 候補の抽出。顧客ごとにルール単位で停止できる (reminderDisabledKeys)
    const ruleWhere = {
      ...BASE_WHERE,
      NOT: { reminderDisabledKeys: { has: def.key } },
    };
    let candidates: { id: string; lastVisitAt: Date | null; lineUserId: string }[] = [];

    if (def.key === "BIRTHDAY") {
      // 誕生日当日 (2/29 生まれは平年 2/28 に送る)
      const month = now.getMonth();
      const day = now.getDate();
      const isFeb28NonLeap =
        month === 1 && day === 28 && new Date(now.getFullYear(), 1, 29).getMonth() !== 1;
      const rows = await prisma.customer.findMany({
        where: { ...ruleWhere, birthday: { not: null } },
        include: { lineAccount: true },
      });
      candidates = rows
        .filter((customer) => {
          const birthday = customer.birthday!;
          if (birthday.getMonth() === month && birthday.getDate() === day) return true;
          return isFeb28NonLeap && birthday.getMonth() === 1 && birthday.getDate() === 29;
        })
        .map((customer) => ({
          id: customer.id,
          lastVisitAt: customer.lastVisitAt,
          lineUserId: customer.lineAccount!.lineUserId,
        }));
    } else {
      // 経過日数ルール。PURCHASE_FOLLOW / REVISIT は送り漏れ救済のため +14日の猶予窓を持つ
      const upperBound =
        def.key === "DORMANT" ? null : daysAgoStart(rule.days + 14, now);
      const rows = await prisma.customer.findMany({
        where: {
          ...ruleWhere,
          lastVisitAt: {
            lte: daysAgoStart(rule.days, now),
            ...(upperBound ? { gte: upperBound } : {}),
          },
        },
        include: { lineAccount: true },
      });
      candidates = rows.map((customer) => ({
        id: customer.id,
        lastVisitAt: customer.lastVisitAt,
        lineUserId: customer.lineAccount!.lineUserId,
      }));
    }

    for (const candidate of candidates) {
      // 二重送信ガード。FAILED (API エラー) は翌日の実行で再試行させるため除外する
      const lastLog = await prisma.lineMessageLog.findFirst({
        where: {
          customerId: candidate.id,
          direction: "OUTBOUND",
          template: templateOf(def.key),
          status: { not: "FAILED" },
        },
        orderBy: { createdAt: "desc" },
      });
      if (lastLog) {
        if (def.key === "DORMANT") {
          if (lastLog.createdAt > daysAgoStart(rule.days, now)) continue;
        } else if (def.key === "BIRTHDAY") {
          if (lastLog.createdAt > daysAgoStart(300, now)) continue;
        } else if (candidate.lastVisitAt && lastLog.createdAt > candidate.lastVisitAt) {
          continue;
        }
      }

      result.targeted += 1;

      let body: string | null = null;
      if (def.key === "PURCHASE_FOLLOW") {
        body = await buildPurchaseFollowMessage(candidate.id);
      } else if (def.key === "REVISIT") {
        body = (await buildRecommendDraft(candidate.id)) ?? (await buildRevisitDraft(candidate.id));
      } else if (def.key === "DORMANT") {
        body = await buildRevisitDraft(candidate.id);
      } else {
        body = await buildBirthdayMessage(candidate.id);
      }
      if (!body) {
        result.failed += 1;
        continue;
      }

      const push = await pushLineText(candidate.lineUserId, body, {
        customerId: candidate.id,
        template: templateOf(def.key),
      });
      if (push.sent) {
        result.sent += 1;
      } else {
        result.failed += 1;
      }
    }
  }

  return results;
}
