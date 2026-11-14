import Constants from "expo-constants";

/**
 * 接続先のサーバー。
 *   1. 環境変数 EXPO_PUBLIC_APP_URL (開発中に手元のサーバーへ向けたいとき)
 *   2. app.json の extra.appUrl (本番)
 */
const DEFAULT_APP_URL = "https://wearpos.ai-labo.cloud";

function resolveAppUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_APP_URL;
  const fromConfig = (Constants.expoConfig?.extra as { appUrl?: unknown } | undefined)?.appUrl;
  const candidate = fromEnv || (typeof fromConfig === "string" ? fromConfig : "") || DEFAULT_APP_URL;
  try {
    return new URL(candidate).origin;
  } catch {
    return DEFAULT_APP_URL;
  }
}

export const APP_URL = resolveAppUrl();
export const APP_VERSION = Constants.expoConfig?.version ?? "0.0.0";
