/**
 * セッショントークンの発行と検証。
 * Edge (middleware) と Node (Server Actions) の両方で動くよう、
 * Web Crypto (crypto.subtle) だけを使う。
 *
 * トークン形式: base64url(JSON) + "." + base64url(HMAC-SHA256)
 */

export type SessionPayload = {
  /** AppUser.id */
  uid: string;
  username: string;
  name: string;
  role: "ADMIN" | "STAFF";
  /** STAFF が使える機能キー。ADMIN は空でも全機能 */
  features: string[];
  /** 有効期限 (unix 秒) */
  exp: number;
};

export const SESSION_COOKIE = "wearpos_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12時間

/**
 * 署名鍵。AUTH_SECRET を推奨。未設定なら POS_API_KEY から導出し、
 * それも無ければ開発用の固定値になる (本番では必ず AUTH_SECRET を設定する)。
 */
function secretSource(): string {
  return (
    process.env.AUTH_SECRET ??
    (process.env.POS_API_KEY ? `wearpos-auth:${process.env.POS_API_KEY}` : "wearpos-dev-secret")
  );
}

const encoder = new TextEncoder();

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secretSource()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

export async function signSession(
  payload: Omit<SessionPayload, "exp">,
  ttlSeconds = SESSION_TTL_SECONDS,
): Promise<string> {
  const full: SessionPayload = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = toBase64Url(encoder.encode(JSON.stringify(full)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(), encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const signatureBytes = fromBase64Url(signature);
  if (!signatureBytes) return null;

  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(),
    signatureBytes as BufferSource,
    encoder.encode(body),
  );
  if (!valid) return null;

  const bodyBytes = fromBase64Url(body);
  if (!bodyBytes) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(bodyBytes)) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp < Date.now() / 1000) return null;
    if (payload.role !== "ADMIN" && payload.role !== "STAFF") return null;
    return payload;
  } catch {
    return null;
  }
}

/** 認証を無効化しているか (静的デモ生成やローカル確認用) */
export function isAuthDisabled(): boolean {
  return process.env.AUTH_DISABLED === "1";
}

// ---- 会員証リンク ----
// お客様の LINE に送る会員証ページ (/card/<token>) 用。ログイン不要でアクセスできるため、
// 顧客IDに署名を付けて推測できないようにする。

export async function signMemberCardToken(customerId: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(),
    encoder.encode(`member-card:${customerId}`),
  );
  return `${customerId}.${toBase64Url(new Uint8Array(signature))}`;
}

/** 会員証トークンを検証し、正当なら顧客IDを返す */
export async function verifyMemberCardToken(token: string): Promise<string | null> {
  const [customerId, signature] = token.split(".");
  if (!customerId || !signature) return null;
  const signatureBytes = fromBase64Url(signature);
  if (!signatureBytes) return null;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(),
    signatureBytes as BufferSource,
    encoder.encode(`member-card:${customerId}`),
  );
  return valid ? customerId : null;
}
