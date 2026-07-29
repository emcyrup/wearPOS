import crypto from "node:crypto";

import { formatYen } from "@/lib/format";
import { prisma } from "@/lib/db";

const LINE_API = "https://api.line.me/v2/bot";

export function lineConfig() {
  return {
    channelSecret: process.env.LINE_CHANNEL_SECRET ?? "",
    accessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
    pushEnabled: process.env.LINE_PUSH_ENABLED !== "false",
  };
}

export function isLineConfigured(): boolean {
  const { channelSecret, accessToken } = lineConfig();
  return Boolean(channelSecret && accessToken);
}

/**
 * LINE Webhook の署名検証。
 * 生のリクエストボディ(文字列)に対して HMAC-SHA256 を計算し base64 で比較する。
 */
export function verifyLineSignature(rawBody: string, signature: string | null): boolean {
  const { channelSecret } = lineConfig();
  if (!channelSecret || !signature) return false;

  const expected = crypto.createHmac("sha256", channelSecret).update(rawBody).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  // 長さが違うと timingSafeEqual が例外を投げるため先に弾く
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** 紛らわしい文字 (0/O, 1/I) を除いた連携コード用の文字集合 */
const TOKEN_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateLinkToken(length = 6): string {
  const bytes = crypto.randomBytes(length);
  let token = "";
  for (let i = 0; i < length; i += 1) {
    token += TOKEN_CHARS[bytes[i] % TOKEN_CHARS.length];
  }
  return token;
}

export const LINK_TOKEN_TTL_MINUTES = 30;

/** 顧客に対する連携コードを発行する。既存の未使用コードは無効化する */
export async function issueLinkToken(customerId: string) {
  await prisma.lineLinkToken.deleteMany({ where: { customerId, usedAt: null } });
  return prisma.lineLinkToken.create({
    data: {
      customerId,
      token: generateLinkToken(),
      expiresAt: new Date(Date.now() + LINK_TOKEN_TTL_MINUTES * 60_000),
    },
  });
}

/**
 * 顧客が LINE で送ってきたテキストを連携コードとして解決し、アカウントを紐付ける。
 * 成功したら顧客を返す。コードが無効なら null。
 */
export async function consumeLinkToken(token: string, lineUserId: string, profile?: LineProfile) {
  const record = await prisma.lineLinkToken.findUnique({
    where: { token: token.trim().toUpperCase() },
    include: { customer: true },
  });

  if (!record || record.usedAt || record.expiresAt < new Date()) return null;

  await prisma.$transaction(async (tx) => {
    await tx.lineAccount.upsert({
      where: { customerId: record.customerId },
      create: {
        customerId: record.customerId,
        lineUserId,
        displayName: profile?.displayName,
        pictureUrl: profile?.pictureUrl,
        isFollowing: true,
      },
      update: {
        lineUserId,
        displayName: profile?.displayName,
        pictureUrl: profile?.pictureUrl,
        isFollowing: true,
        unfollowedAt: null,
      },
    });
    await tx.lineLinkToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
  });

  return record.customer;
}

export type LineProfile = {
  userId: string;
  displayName?: string;
  pictureUrl?: string;
};

export async function fetchLineProfile(lineUserId: string): Promise<LineProfile | null> {
  const { accessToken } = lineConfig();
  if (!accessToken) return null;

  try {
    const res = await fetch(`${LINE_API}/profile/${lineUserId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as LineProfile;
  } catch {
    return null;
  }
}

type PushOptions = {
  customerId?: string | null;
  template?: string;
};

/**
 * LINE へテキストをプッシュ送信し、結果を LineMessageLog に残す。
 * トークン未設定や送信無効時はログだけ残して送信をスキップする (開発環境向け)。
 */
export async function pushLineText(
  lineUserId: string,
  text: string,
  options: PushOptions = {},
): Promise<{ sent: boolean; error?: string }> {
  const { accessToken, pushEnabled } = lineConfig();

  const log = async (status: string, error?: string) => {
    await prisma.lineMessageLog.create({
      data: {
        customerId: options.customerId ?? undefined,
        lineUserId,
        direction: "OUTBOUND",
        messageType: "TEXT",
        body: text,
        template: options.template,
        status,
        error,
      },
    });
  };

  if (!accessToken || !pushEnabled) {
    await log("SKIPPED", accessToken ? "LINE_PUSH_ENABLED=false" : "アクセストークン未設定");
    return { sent: false, error: "LINE 送信は無効化されています" };
  }

  try {
    const res = await fetch(`${LINE_API}/message/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ to: lineUserId, messages: [{ type: "text", text }] }),
    });

    if (!res.ok) {
      const detail = await res.text();
      await log("FAILED", `${res.status} ${detail}`.slice(0, 500));
      return { sent: false, error: `LINE API エラー: ${res.status}` };
    }

    await log("SENT");
    return { sent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await log("FAILED", message);
    return { sent: false, error: message };
  }
}

export async function replyLineText(replyToken: string, text: string) {
  const { accessToken, pushEnabled } = lineConfig();
  if (!accessToken || !pushEnabled) return { sent: false };

  try {
    const res = await fetch(`${LINE_API}/message/reply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
    });
    return { sent: res.ok };
  } catch {
    return { sent: false };
  }
}

// ---------------------------------------------------------------------------
// メッセージテンプレート
// ---------------------------------------------------------------------------

export function purchaseThanksMessage(params: {
  customerName: string;
  storeName: string;
  total: number;
  pointsEarned: number;
  pointsBalance: number;
}): string {
  return [
    `${params.customerName} 様`,
    "",
    "本日はご来店ありがとうございました。",
    `【店舗】${params.storeName}`,
    `【お買い上げ金額】${formatYen(params.total)}`,
    `【獲得ポイント】${params.pointsEarned} pt`,
    `【現在のポイント】${params.pointsBalance} pt`,
    "",
    "またのご来店をお待ちしております。",
  ].join("\n");
}

export function linkSuccessMessage(customerName: string, points: number): string {
  return [
    `${customerName} 様`,
    "",
    "会員情報の連携が完了しました。",
    `現在のポイント: ${points} pt`,
    "",
    "今後、お買い上げ内容やお得なご案内をこちらのトークにお送りします。",
  ].join("\n");
}

export const LINK_GUIDE_MESSAGE = [
  "友だち追加ありがとうございます。",
  "",
  "会員情報を連携すると、お買い上げ履歴やポイント残高をこちらで確認できます。",
  "店頭スタッフが発行する6桁の連携コードを、このトークに送信してください。",
].join("\n");
