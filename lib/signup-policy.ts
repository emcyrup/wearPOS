import { hashPassword, verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/db";

/**
 * ログイン画面からの新規ユーザー作成 (セルフサインアップ) の方針。
 *
 * - OPEN: だれでも作成できる
 * - CODE: 店舗の合言葉を知っている人だけ作成できる
 * - OFF:  作成させない (管理者が設定画面から追加する運用)
 */
export type SignupMode = "OPEN" | "CODE" | "OFF";

export type SignupPolicy = {
  mode: SignupMode;
  /** CODE のときに合言葉が設定済みかどうか (値そのものは返さない) */
  hasCode: boolean;
};

const MODE_KEY = "signup.mode";
const CODE_KEY = "signup.codeHash";

/** 既定は「だれでも作成できる」。作成されるのはスタッフ権限 + 既定機能のみ */
export const DEFAULT_SIGNUP_MODE: SignupMode = "OPEN";

function toMode(value: string | undefined): SignupMode {
  return value === "OPEN" || value === "CODE" || value === "OFF" ? value : DEFAULT_SIGNUP_MODE;
}

export async function getSignupPolicy(): Promise<SignupPolicy> {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: [MODE_KEY, CODE_KEY] } } });
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  return {
    mode: toMode(byKey.get(MODE_KEY)),
    hasCode: Boolean(byKey.get(CODE_KEY)),
  };
}

/**
 * 方針を保存する。
 * code が undefined なら合言葉は変更しない。空文字なら削除する。
 * 合言葉はハッシュ化して保存し、平文では持たない。
 */
export async function saveSignupPolicy(mode: SignupMode, code?: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: MODE_KEY },
    update: { value: mode },
    create: { key: MODE_KEY, value: mode },
  });

  if (code === undefined) return;
  if (code === "") {
    await prisma.appSetting.deleteMany({ where: { key: CODE_KEY } });
    return;
  }
  const hash = hashPassword(code);
  await prisma.appSetting.upsert({
    where: { key: CODE_KEY },
    update: { value: hash },
    create: { key: CODE_KEY, value: hash },
  });
}

/** 入力された合言葉が正しいか。合言葉が未設定なら常に false */
export async function verifySignupCode(code: string): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: CODE_KEY } });
  if (!row) return false;
  return verifyPassword(code, row.value);
}
