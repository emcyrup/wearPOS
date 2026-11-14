import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";

import { buildInjectedScript, parseBridgeMessage } from "./bridge";

/** 差し込むスクリプトを、ブラウザに見立てた環境で実際に動かす */
function runInPage(options: { popup: boolean }) {
  const posted: string[] = [];
  let closedNatively = 0;
  const window: Record<string, unknown> = {
    ReactNativeWebView: { postMessage: (data: string) => posted.push(data) },
    print: () => {
      throw new Error("本来の print が呼ばれた");
    },
    close: () => {
      closedNatively += 1;
    },
  };
  const context = vm.createContext({
    window,
    document: {
      title: "レシート R260907-001",
      documentElement: { outerHTML: "<html><head></head><body>合計 ￥5,500</body></html>" },
    },
    location: { href: "https://wearpos.ai-labo.cloud/sales/abc/receipt" },
    URL,
  });
  const result = vm.runInContext(buildInjectedScript({ ...options, appVersion: "1.0.0" }), context);
  return { window, posted, result, closedNatively: () => closedNatively };
}

test("スクリプトは最後に true を返す (iOS で警告を出さないため)", () => {
  assert.equal(runInPage({ popup: false }).result, true);
});

test("window.print() が印刷の依頼に変わる", () => {
  const page = runInPage({ popup: false });
  (page.window.print as () => void)();
  assert.equal(page.posted.length, 1);
  const message = parseBridgeMessage(page.posted[0]);
  assert.deepEqual(message, {
    type: "print",
    title: "レシート R260907-001",
    html: "<!DOCTYPE html><html><head></head><body>合計 ￥5,500</body></html>",
    baseUrl: "https://wearpos.ai-labo.cloud/sales/abc/receipt",
  });
});

test("別ウィンドウでは window.close() が閉じる依頼に変わる", () => {
  const page = runInPage({ popup: true });
  (page.window.close as () => void)();
  assert.deepEqual(parseBridgeMessage(page.posted[0]), { type: "close" });
  assert.equal(page.closedNatively(), 0);
});

test("通常の画面では window.close() を差し替えない", () => {
  const page = runInPage({ popup: false });
  (page.window.close as () => void)();
  assert.equal(page.posted.length, 0);
  assert.equal(page.closedNatively(), 1);
});

test("二重に差し込まれても 1 回しか効かない", () => {
  const page = runInPage({ popup: false });
  const first = page.window.print;
  vm.runInContext(buildInjectedScript({ popup: true, appVersion: "1.0.0" }), vm.createContext({ window: page.window }));
  assert.equal(page.window.print, first);
});

test("形の合わないメッセージは捨てる", () => {
  assert.equal(parseBridgeMessage("not json"), null);
  assert.equal(parseBridgeMessage("null"), null);
  assert.equal(parseBridgeMessage('"print"'), null);
  assert.equal(parseBridgeMessage('{"type":"unknown"}'), null);
  assert.equal(parseBridgeMessage('{"type":"print"}'), null);
  assert.equal(parseBridgeMessage('{"type":"print","html":"","baseUrl":"https://x"}'), null);
  assert.equal(parseBridgeMessage('{"type":"print","html":123,"baseUrl":"https://x"}'), null);
  const huge = JSON.stringify({ type: "print", html: "x".repeat(5_000_001), baseUrl: "https://x" });
  assert.equal(parseBridgeMessage(huge), null);
});

test("window.open(url) が別ウィンドウの依頼に変わる (レシート印刷ボタンの書き方)", () => {
  const page = runInPage({ popup: false });
  (page.window.open as (...a: unknown[]) => unknown)("/sales/abc/receipt", "wearpos-receipt", "popup=yes,width=480");
  assert.deepEqual(parseBridgeMessage(page.posted[0]), {
    type: "open",
    url: "https://wearpos.ai-labo.cloud/sales/abc/receipt",
  });
});

test("空のウィンドウを開いてから行き先を入れる書き方でも開ける (サイドメニューの「レジ ↗」)", () => {
  const page = runInPage({ popup: false });
  // components/nav-links.tsx と同じ手順
  const win = (page.window.open as (...a: unknown[]) => any)("", "wearpos-register", "popup=yes");
  assert.ok(win, "戻り値が無いと Web 側は「ブロックされた」と判断して何もしない");
  assert.equal(page.posted.length, 0, "行き先が決まるまでは依頼しない");
  if (!win.location.pathname.startsWith("/register")) win.location.href = "/register";
  win.focus();
  assert.deepEqual(parseBridgeMessage(page.posted[0]), {
    type: "open",
    url: "https://wearpos.ai-labo.cloud/register",
  });
  win.location.href = "/register";
  assert.equal(page.posted.length, 1, "同じウィンドウから二重には開かない");
});

test("open の依頼は URL が無い・長すぎると捨てる", () => {
  assert.equal(parseBridgeMessage('{"type":"open"}'), null);
  assert.equal(parseBridgeMessage('{"type":"open","url":""}'), null);
  assert.equal(parseBridgeMessage(JSON.stringify({ type: "open", url: "https://x/" + "a".repeat(2000) })), null);
});
