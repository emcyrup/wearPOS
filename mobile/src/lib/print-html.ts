/**
 * 画面の HTML を、印刷用の描画に渡せる形へ整える。
 *
 * 印刷は「いま表示している画面の HTML」を OS の印刷機能へ渡して行う。
 * そのままだと 2 つ困ることがある。
 *   - スクリプトが印刷用の描画の中でもう一度動き、通信や再描画を始めてしまう
 *   - スタイルシートが相対パス (/_next/static/...) なので読み込めず、レイアウトが崩れる
 * そこでスクリプトを取り除き、相対パスの基準になる <base> を入れる。
 */
export function prepareHtmlForPrint(html: string, baseUrl: string): string {
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    origin = "";
  }

  const withoutScripts = html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    // スクリプトの先読み指定も不要 (印刷用の描画から余計な通信をしない)
    .replace(/<link\b[^>]*\bas=["']?script["']?[^>]*>/gi, "");

  if (!origin) return withoutScripts;

  const base = `<base href="${origin}/">`;
  // 元のページが <base> を持っていれば、そちらを優先する
  if (/<base\b/i.test(withoutScripts)) return withoutScripts;
  if (/<head\b[^>]*>/i.test(withoutScripts)) {
    return withoutScripts.replace(/<head\b[^>]*>/i, (head) => `${head}${base}`);
  }
  return `${base}${withoutScripts}`;
}
