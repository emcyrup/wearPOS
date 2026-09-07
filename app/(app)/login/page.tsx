import { LoginPanel, SetupForm } from "@/components/login-form";
import { hasAnyUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isSigningKeyMissing, SIGNING_KEY_MISSING_MESSAGE } from "@/lib/session";
import { getSignupPolicy } from "@/lib/signup-policy";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const initialized = await hasAnyUser();
  // 署名鍵が無いとログインを発行できない。500 にせず、ここで理由を見せる
  const keyMissing = isSigningKeyMissing();

  // 店頭のタブレットでも選びやすいよう、ユーザー名は選択式にする
  const [users, policy] = await Promise.all([
    initialized
      ? prisma.appUser.findMany({
          where: { isActive: true },
          select: { username: true, displayName: true, role: true },
          orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        })
      : Promise.resolve([]),
    getSignupPolicy(),
  ]);

  const canSignUp = policy.mode !== "OFF";

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-2xl font-semibold tracking-tight text-ink-900">
            wear<span className="text-accent">POS</span>
          </p>
          <p className="mt-1 text-sm text-ink-400">
            {initialized
              ? canSignUp
                ? "ログイン、または新規ユーザーを作成してください"
                : "ユーザー名とパスワードでログインしてください"
              : "はじめに管理者アカウントを作成します"}
          </p>
        </div>
        {keyMissing && (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
          >
            <p className="font-semibold">サーバーの設定が完了していません</p>
            <p className="mt-1">{SIGNING_KEY_MISSING_MESSAGE}</p>
            <p className="mt-1 text-xs text-rose-700">
              設定されるまでログインできません（誰もログインできない状態なので、データが漏れることはありません）
            </p>
          </div>
        )}
        <div className="rounded-xl border border-ink-200 bg-white p-6">
          {initialized ? (
            <LoginPanel users={users} canSignUp={canSignUp} needsCode={policy.mode === "CODE"} />
          ) : (
            <SetupForm />
          )}
        </div>
        {!initialized && (
          <p className="mt-3 text-center text-xs text-ink-400">
            作成後、設定画面からスタッフ用ユーザーを追加できます
          </p>
        )}
      </div>
    </div>
  );
}
