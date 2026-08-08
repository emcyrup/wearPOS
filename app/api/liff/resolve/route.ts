import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { verifyLiffIdToken } from "@/lib/line";
import { signMemberCardToken, signSignupToken } from "@/lib/session";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  idToken: z.string().min(1),
  dest: z.enum(["signup", "card", "points"]),
});

/**
 * LIFF から受け取った ID トークンを検証し、遷移先の本人専用 URL を返す。
 *
 * POST /api/liff/resolve
 * Body: { idToken, dest: "signup" | "card" | "points" }
 * - 未登録の人が card / points を開いたら登録フォームへ
 * - 登録済みの人が signup を開いたら会員証へ
 */
export async function POST(request: Request) {
  let parsed;
  try {
    parsed = requestSchema.safeParse(await request.json());
  } catch {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }

  const lineUserId = await verifyLiffIdToken(parsed.data.idToken);
  if (!lineUserId) {
    return NextResponse.json(
      { error: "本人確認に失敗しました。トークを開き直してもう一度お試しください" },
      { status: 401 },
    );
  }

  const account = await prisma.lineAccount.findUnique({ where: { lineUserId } });

  // 未登録なら常に登録フォームへ
  if (!account) {
    return NextResponse.json({ url: `/signup/${await signSignupToken(lineUserId)}` });
  }

  const cardToken = await signMemberCardToken(account.customerId);
  const url =
    parsed.data.dest === "points" ? `/points/${cardToken}` : `/card/${cardToken}`;
  return NextResponse.json({ url });
}
