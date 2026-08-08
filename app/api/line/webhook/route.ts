import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { formatYen, fullName } from "@/lib/format";
import {
  consumeLinkToken,
  fetchLineProfile,
  isLineConfigured,
  linkSuccessMessage,
  LINK_GUIDE_MESSAGE,
  registerCustomerFromLine,
  replyLineText,
  verifyLineSignature,
} from "@/lib/line";
import { signMemberCardToken } from "@/lib/session";

export const dynamic = "force-dynamic";

type LineEvent = {
  type: string;
  replyToken?: string;
  source?: { userId?: string; type?: string };
  message?: { type?: string; text?: string };
};

/**
 * LINE Messaging API の Webhook。
 *
 * POST /api/line/webhook
 * - follow:   連携の案内を返す
 * - unfollow: ブロックとして記録する
 * - message:  6桁コードなら会員連携、それ以外はキーワード応答
 *
 * 署名検証に失敗したリクエストは 401 で拒否する。
 */
/**
 * 設定確認用。ブラウザや curl でこの URL を開くと、
 * URL の打ち間違いと環境変数の反映状態をその場で確認できる (秘密情報は返さない)。
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "wearPOS LINE webhook",
    channelSecretConfigured: Boolean(process.env.LINE_CHANNEL_SECRET),
    accessTokenConfigured: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN),
    hint: "この URL を LINE Developers の Webhook URL に設定します。検証は POST で行われます",
  });
}

export async function POST(request: Request) {
  if (!isLineConfigured()) {
    return NextResponse.json({ error: "LINE の認証情報が未設定です" }, { status: 503 });
  }

  // 署名は生ボディに対して計算されるので、パース前に文字列で受け取る
  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature");

  if (!verifyLineSignature(rawBody, signature)) {
    // 検証が 401 になったとき Vercel のログで原因を追えるようにする
    console.error(
      "LINE webhook 署名不一致: LINE_CHANNEL_SECRET がこのチャネルのシークレットと一致していません",
    );
    return NextResponse.json(
      {
        error:
          "署名が一致しません。LINE_CHANNEL_SECRET に「チャネル基本設定」タブのチャネルシークレットが正しく設定されているか確認してください",
      },
      { status: 401 },
    );
  }

  let events: LineEvent[] = [];
  try {
    events = (JSON.parse(rawBody).events ?? []) as LineEvent[];
  } catch {
    return NextResponse.json({ error: "JSON の解析に失敗しました" }, { status: 400 });
  }

  for (const event of events) {
    const lineUserId = event.source?.userId;
    if (!lineUserId) continue;

    try {
      await handleEvent(event, lineUserId, appOrigin(request));
    } catch (error) {
      // 1件の失敗で全体を落とさない。LINE 側の再送を避けるため 200 を返し続ける
      console.error("LINE イベントの処理に失敗しました", error);
    }
  }

  return NextResponse.json({ ok: true });
}

/** 会員証リンクなどに使う自アプリの公開 URL。プロキシ配下でも正しいホストを使う */
function appOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return process.env.APP_URL ?? `${proto}://${host}`;
}

async function handleEvent(event: LineEvent, lineUserId: string, origin: string) {
  if (event.type === "follow") {
    await prisma.lineAccount.updateMany({
      where: { lineUserId },
      data: { isFollowing: true, unfollowedAt: null },
    });
    await logInbound(lineUserId, "EVENT", "follow");
    if (event.replyToken) await replyLineText(event.replyToken, LINK_GUIDE_MESSAGE);
    return;
  }

  if (event.type === "unfollow") {
    await prisma.lineAccount.updateMany({
      where: { lineUserId },
      data: { isFollowing: false, unfollowedAt: new Date() },
    });
    await logInbound(lineUserId, "EVENT", "unfollow");
    return;
  }

  if (event.type !== "message" || event.message?.type !== "text") return;

  const text = (event.message.text ?? "").trim();
  await logInbound(lineUserId, "TEXT", text);

  const account = await prisma.lineAccount.findUnique({
    where: { lineUserId },
    include: { customer: true },
  });

  // 未連携で 6 桁コードらしき文字列なら連携を試みる
  if (!account && /^[A-Za-z0-9]{6}$/.test(text)) {
    const profile = await fetchLineProfile(lineUserId);
    const customer = await consumeLinkToken(text, lineUserId, profile ?? undefined);

    if (customer && event.replyToken) {
      await replyLineText(event.replyToken, linkSuccessMessage(fullName(customer), customer.points));
    } else if (event.replyToken) {
      await replyLineText(
        event.replyToken,
        "連携コードが無効か、有効期限が切れています。店頭スタッフに再発行をご依頼ください。",
      );
    }
    return;
  }

  // 未連携ユーザー: お名前の送信による新規会員登録 (確認 → 「はい」で確定)
  if (!account) {
    const reply = await handleRegistration(lineUserId, text, origin);
    if (reply && event.replyToken) await replyLineText(event.replyToken, reply);
    return;
  }

  // 連携済み顧客からの問い合わせに応答する
  const reply = await buildReply(text, account.customerId, origin);
  if (reply && event.replyToken) await replyLineText(event.replyToken, reply);
}

/** 登録確認の有効期限 (分) */
const REGISTRATION_TTL_MINUTES = 30;

/** 名前として受け付けない入力 (機能キーワードや長すぎる文字列) */
function looksLikeName(text: string): boolean {
  if (text.length < 1 || text.length > 30) return false;
  if (/https?:\/\/|\n/.test(text)) return false;
  if (/ポイント|履歴|会員証|カード|バーコード|ヘルプ|help/i.test(text)) return false;
  return true;
}

/**
 * 未連携ユーザーからのテキストを新規会員登録として処理する。
 * 1. お名前を送信 → 確認メッセージ (30分有効)
 * 2. 「はい」 → 会員番号を払い出して登録し、会員証リンクを案内
 * 3. 「いいえ」 → 取り消し
 */
async function handleRegistration(
  lineUserId: string,
  text: string,
  origin: string,
): Promise<string> {
  const pending = await prisma.lineRegistration.findUnique({ where: { lineUserId } });
  const pendingAlive = pending && pending.expiresAt > new Date();

  if (pendingAlive && /^(はい|ハイ|はい。|ok|okay|yes)$/i.test(text)) {
    const profile = await fetchLineProfile(lineUserId);
    const customer = await registerCustomerFromLine(lineUserId, pending.name, profile);
    await prisma.lineRegistration.delete({ where: { lineUserId } }).catch(() => undefined);

    const cardToken = await signMemberCardToken(customer.id);
    return [
      `${fullName(customer)} 様、会員登録が完了しました🎉`,
      `会員番号: ${customer.memberCode}`,
      "",
      "デジタル会員証はこちらです。お会計の際にレジでご提示ください。",
      `${origin}/card/${cardToken}`,
      "",
      "お買い上げ金額に応じてポイントが貯まります。",
      "「ポイント」「履歴」「会員証」と送信するといつでも確認できます。",
    ].join("\n");
  }

  if (pendingAlive && /^(いいえ|キャンセル|やめる|no)$/i.test(text)) {
    await prisma.lineRegistration.delete({ where: { lineUserId } }).catch(() => undefined);
    return "登録を取り消しました。改めて登録する場合は、お名前を送信してください。";
  }

  if (looksLikeName(text)) {
    await prisma.lineRegistration.upsert({
      where: { lineUserId },
      create: {
        lineUserId,
        name: text,
        expiresAt: new Date(Date.now() + REGISTRATION_TTL_MINUTES * 60_000),
      },
      update: {
        name: text,
        expiresAt: new Date(Date.now() + REGISTRATION_TTL_MINUTES * 60_000),
      },
    });
    return [
      `「${text}」様として新規会員登録します。`,
      "よろしければ「はい」と返信してください。",
      "",
      "・お名前を修正する場合は、正しいお名前をもう一度送信してください",
      "・すでに会員の方は、店頭スタッフが発行する6桁の連携コードを送信してください",
    ].join("\n");
  }

  return LINK_GUIDE_MESSAGE;
}

async function buildReply(text: string, customerId: string, origin: string): Promise<string | null> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: { sales: { orderBy: { soldAt: "desc" }, take: 1, include: { store: true } } },
  });
  if (!customer) return null;

  if (/会員証|カード|バーコード/i.test(text)) {
    const token = await signMemberCardToken(customer.id);
    return [
      `${fullName(customer)} 様の会員証はこちらです。`,
      `${origin}/card/${token}`,
      "",
      "お会計の際に、開いたバーコードをレジでご提示ください。",
    ].join("\n");
  }

  if (/ポイント|point|残高/i.test(text)) {
    return `${fullName(customer)} 様の現在のポイントは ${customer.points} pt です。`;
  }

  if (/履歴|購入|買った/.test(text)) {
    const last = customer.sales[0];
    if (!last) return "お買い上げ履歴がまだございません。";
    return [
      "直近のお買い上げ内容です。",
      `【日付】${last.soldAt.toLocaleDateString("ja-JP")}`,
      `【店舗】${last.store.name}`,
      `【金額】${formatYen(last.total)}`,
    ].join("\n");
  }

  return [
    "以下のキーワードにお答えできます。",
    "・「会員証」… レジで提示できる会員証バーコード",
    "・「ポイント」… 現在のポイント残高",
    "・「履歴」… 直近のお買い上げ内容",
    "",
    "その他のお問い合わせは店頭スタッフまでお願いいたします。",
  ].join("\n");
}

async function logInbound(lineUserId: string, messageType: string, body: string) {
  const account = await prisma.lineAccount.findUnique({ where: { lineUserId } });
  await prisma.lineMessageLog.create({
    data: {
      customerId: account?.customerId,
      lineUserId,
      direction: "INBOUND",
      messageType,
      body,
      status: "RECEIVED",
    },
  });
}
