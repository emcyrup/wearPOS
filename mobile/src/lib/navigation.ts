/**
 * アプリ内の WebView で開いてよい URL かどうかを決める。
 *
 * WebView には印刷などのためにネイティブ側とやり取りする橋 (bridge) を差し込んでいる。
 * 外部サイトをアプリ内で開くと、そのサイトからも橋を呼べてしまうので、
 * 自分のサーバー以外は必ず端末のブラウザや対応アプリへ渡す。
 */
export type NavigationDecision = "inside" | "external" | "blocked";

/** 端末のアプリやブラウザへ渡してよいスキーム */
const EXTERNAL_SCHEMES = new Set(["http:", "https:", "tel:", "mailto:", "sms:", "line:"]);

export function decideNavigation(url: string, appUrl: string): NavigationDecision {
  // iframe の初期状態など。画面遷移ではないので通す
  if (url === "about:blank" || url === "about:srcdoc") return "inside";

  let target: URL;
  let app: URL;
  try {
    target = new URL(url);
    app = new URL(appUrl);
  } catch {
    return "blocked";
  }

  if (target.origin === app.origin) return "inside";
  if (EXTERNAL_SCHEMES.has(target.protocol)) return "external";

  // javascript: / data: / file: など。アプリ内でも外でも開かない
  return "blocked";
}

/** アプリのサーバー上のパスを絶対 URL にする */
export function appPath(path: string, appUrl: string): string {
  return new URL(path, appUrl).toString();
}
