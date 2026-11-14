import assert from "node:assert/strict";
import { test } from "node:test";

import { prepareHtmlForPrint } from "./print-html";

const BASE = "https://wearpos.ai-labo.cloud/sales/abc/receipt";

test("スクリプトを取り除く (印刷用の描画で再実行させない)", () => {
  const html =
    '<html><head><script src="/_next/static/chunks/main.js"></script></head>' +
    "<body><p>合計</p><script>self.__next_f.push([1])</script><SCRIPT type=\"module\">x()</SCRIPT></body></html>";
  const out = prepareHtmlForPrint(html, BASE);
  assert.ok(!/<script/i.test(out));
  assert.ok(out.includes("<p>合計</p>"));
});

test("スクリプトの先読み指定を取り除き、スタイルシートは残す", () => {
  const html =
    '<html><head><link rel="preload" as="script" href="/_next/a.js">' +
    '<link rel="stylesheet" href="/_next/static/css/app.css"></head><body></body></html>';
  const out = prepareHtmlForPrint(html, BASE);
  assert.ok(!out.includes("/_next/a.js"));
  assert.ok(out.includes('href="/_next/static/css/app.css"'));
});

test("相対パスの基準として <base> を head の先頭に入れる", () => {
  const out = prepareHtmlForPrint('<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"></head><body></body></html>', BASE);
  assert.ok(out.includes('<head><base href="https://wearpos.ai-labo.cloud/"><meta charset="utf-8">'));
});

test("元のページに <base> があれば足さない", () => {
  const html = '<html><head><base href="https://cdn.example/"></head><body></body></html>';
  assert.equal(prepareHtmlForPrint(html, BASE), html);
});

test("head が無い HTML でも <base> を付ける", () => {
  assert.equal(prepareHtmlForPrint("<p>a</p>", BASE), '<base href="https://wearpos.ai-labo.cloud/"><p>a</p>');
});

test("基準 URL が壊れていても、スクリプト除去だけは行う", () => {
  assert.equal(prepareHtmlForPrint("<p>a</p><script>x</script>", "not a url"), "<p>a</p>");
});
