import { prisma } from "@/lib/db";

/**
 * AI考察の外部送信に関する設定。
 *
 * 送っているのは集計済みの数値だけで、顧客の氏名・連絡先・個別の購入履歴は含まない。
 * スタッフ氏名も「スタッフA」などの記号に置き換えてから送る (lib/insights.ts)。
 * それでも外部送信そのものを止めたい場合に備え、ChatGPT への送信は設定でオフにできる。
 */
const CHATGPT_ENABLED_KEY = "insights.chatgptEnabled";

/** ChatGPT (OpenAI) へデータを送ってよいか。既定は許可 */
export async function isChatGptEnabled(): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: CHATGPT_ENABLED_KEY } });
  // 未設定なら従来どおり討論する
  return row?.value !== "false";
}

export async function setChatGptEnabled(enabled: boolean): Promise<void> {
  const value = enabled ? "true" : "false";
  await prisma.appSetting.upsert({
    where: { key: CHATGPT_ENABLED_KEY },
    update: { value },
    create: { key: CHATGPT_ENABLED_KEY, value },
  });
}
