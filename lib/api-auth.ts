import crypto from "node:crypto";
import { NextResponse } from "next/server";

/**
 * POS 連携 API の認証。
 * X-API-Key ヘッダ (または Authorization: Bearer) を共有シークレットと突き合わせる。
 */
export function authorizePosRequest(request: Request): NextResponse | null {
  const expected = process.env.POS_API_KEY;

  if (!expected) {
    return NextResponse.json(
      { error: "POS_API_KEY が未設定のため API を利用できません" },
      { status: 503 },
    );
  }

  const header = request.headers.get("x-api-key");
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const provided = header ?? bearer ?? "";

  if (!timingSafeEquals(provided, expected)) {
    return NextResponse.json({ error: "APIキーが正しくありません" }, { status: 401 });
  }

  return null;
}

function timingSafeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
