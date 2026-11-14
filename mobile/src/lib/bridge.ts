/**
 * Web 画面とネイティブ側をつなぐ橋。
 *
 * WebView の中では、ブラウザなら動く次の 3 つが動かない。
 *   - window.print()  … 何も起きない (レシート・値札の印刷ができない)
 *   - window.open()   … 戻り値が無く、「空のウィンドウを開いてから行き先を入れる」
 *                        書き方 (サイドメニューの「レジ ↗」) だと何も開かない
 *   - window.close()  … 別ウィンドウとして開いた画面を閉じられない
 * そこでページの読み込み前にこの 3 つを差し替え、ネイティブ側へ依頼を送らせる。
 * Web 側のコードは変更しない (ブラウザで開いたときは今までどおり動く)。
 */

export type BridgeMessage =
  | { type: "print"; title: string; html: string; baseUrl: string }
  | { type: "open"; url: string }
  | { type: "close" };

/** 印刷する HTML の上限。これを超える依頼は壊れているとみなして捨てる */
const MAX_HTML_LENGTH = 5_000_000;

/**
 * ページに差し込むスクリプト。
 * @param popup 別ウィンドウとして開いた画面なら true (window.close を差し替える)
 */
export function buildInjectedScript(options: { popup: boolean; appVersion: string }): string {
  return `(function () {
  if (window.__wearposApp) return;
  window.__wearposApp = { version: ${JSON.stringify(options.appVersion)} };

  function post(message) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }

  window.print = function () {
    post({
      type: "print",
      title: document.title || "",
      html: "<!DOCTYPE html>" + document.documentElement.outerHTML,
      baseUrl: location.href
    });
  };

  // 別ウィンドウを開く依頼。行き先が決まった時点 (open の引数、または後から入れられた
  // location.href) でネイティブ側へ伝える。呼び出し元には、ウィンドウに見える最小限の物を返す
  window.open = function (url) {
    var requested = false;
    function request(target) {
      if (requested || !target) return;
      try {
        var absolute = new URL(String(target), location.href).href;
        if (absolute === "about:blank") return;
        requested = true;
        post({ type: "open", url: absolute });
      } catch (e) {}
    }
    request(url);
    return {
      closed: false,
      focus: function () {},
      blur: function () {},
      close: function () {},
      location: {
        get href() { return "about:blank"; },
        set href(value) { request(value); },
        get pathname() { return "blank"; },
        assign: function (value) { request(value); },
        replace: function (value) { request(value); }
      }
    };
  };

  if (${options.popup ? "true" : "false"}) {
    window.close = function () { post({ type: "close" }); };
  }
})();
true;`;
}

/** WebView から届いた文字列を検証して取り出す。形が合わなければ null */
export function parseBridgeMessage(data: string): BridgeMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const message = value as Record<string, unknown>;

  if (message.type === "close") return { type: "close" };

  if (message.type === "open") {
    // 開いてよい URL かどうかは受け取った側 (decideNavigation) で判定する
    if (typeof message.url !== "string" || message.url.length === 0 || message.url.length > 2000) return null;
    return { type: "open", url: message.url };
  }

  if (message.type === "print") {
    const { html, baseUrl, title } = message;
    if (typeof html !== "string" || typeof baseUrl !== "string") return null;
    if (html.length === 0 || html.length > MAX_HTML_LENGTH) return null;
    return { type: "print", html, baseUrl, title: typeof title === "string" ? title : "" };
  }

  return null;
}
