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
 * 署名鍵。AUTH_SECRET を使う。未設定なら POS_API_KEY から導出する。
 *
 * どちらも無い場合、開発では固定値を使うが **本番では例外にする**。
 * 固定値のまま本番に出ると、その値を知っている人が誰でも管理者のセッションを
 * 偽造できてしまうため、動かないことで気づけるようにする。
 */
const DEV_FALLBACK_SECRET = "wearpos-dev-secret";

function secretSource(): string {
  const configured =
    process.env.AUTH_SECRET ??
    (process.env.POS_API_KEY ? `wearpos-auth:${process.env.POS_API_KEY}` : null);
  if (configured) return configured;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET が設定されていません。セッションの署名鍵が既定値のままになるため起動できません " +
        "(openssl rand -base64 32 で生成した値を環境変数に設定してください)",
    );
  }
  return DEV_FALLBACK_SECRET;
}

/** 署名鍵が設定されているか (設定画面の点検表示に使う) */
export function isAuthSecretConfigured(): boolean {
  return Boolean(process.env.AUTH_SECRET ?? process.env.POS_API_KEY);
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

// ---- レジ端末の認可 ----
// 店頭のレジ端末は、レジ端末コードを一度入力すると以降ログインなしで使えるようにする。
// 端末ごとの Cookie に「いつまで有効か」を署名付きで持たせる。

export async function signRegisterToken(ttlSeconds: number): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = `register:${expiresAt}`;
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(), encoder.encode(body));
  return `${expiresAt}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifyRegisterToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [expiresAt, signature] = token.split(".");
  if (!expiresAt || !signature) return false;

  const signatureBytes = fromBase64Url(signature);
  if (!signatureBytes) return false;

  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(),
    signatureBytes as BufferSource,
    encoder.encode(`register:${expiresAt}`),
  );
  if (!valid) return false;

  const expiry = Number(expiresAt);
  return Number.isFinite(expiry) && expiry > Date.now() / 1000;
}

/** 認証を無効化しているか (静的デモ生成やローカル確認用) */
export function isAuthDisabled(): boolean {
  return process.env.AUTH_DISABLED === "1";
}

// ---- LINE 新規登録フォーム ----
// 友だち追加時に配信する登録フォーム (/signup/<token>) 用。
// LINE ユーザー ID に署名を付け、本人に送った URL からしか登録できないようにする。

export async function signSignupToken(lineUserId: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(),
    encoder.encode(`line-signup:${lineUserId}`),
  );
  return `${lineUserId}.${toBase64Url(new Uint8Array(signature))}`;
}

/** 登録フォームのトークンを検証し、正当なら LINE ユーザー ID を返す */
export async function verifySignupToken(token: string): Promise<string | null> {
  const [lineUserId, signature] = token.split(".");
  if (!lineUserId || !signature) return null;
  const signatureBytes = fromBase64Url(signature);
  if (!signatureBytes) return null;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(),
    signatureBytes as BufferSource,
    encoder.encode(`line-signup:${lineUserId}`),
  );
  return valid ? lineUserId : null;
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
