import assert from "node:assert/strict";
import { test } from "node:test";

import { appPath, decideNavigation } from "./navigation";

const APP = "https://wearpos.ai-labo.cloud";

test("自分のサーバーの画面はアプリ内で開く", () => {
  assert.equal(decideNavigation("https://wearpos.ai-labo.cloud/", APP), "inside");
  assert.equal(decideNavigation("https://wearpos.ai-labo.cloud/sales/abc/receipt", APP), "inside");
  assert.equal(decideNavigation("https://wearpos.ai-labo.cloud/register?x=1#top", APP), "inside");
});

test("iframe の初期状態は止めない", () => {
  assert.equal(decideNavigation("about:blank", APP), "inside");
});

test("外部サイトと LINE・電話は端末側のアプリへ渡す", () => {
  assert.equal(decideNavigation("https://line.me/R/ti/p/@example", APP), "external");
  assert.equal(decideNavigation("https://liff.line.me/1234-abcd", APP), "external");
  assert.equal(decideNavigation("line://ti/p/@example", APP), "external");
  assert.equal(decideNavigation("tel:0312345678", APP), "external");
  assert.equal(decideNavigation("mailto:shop@example.com", APP), "external");
});

test("似た名前の別ドメインや http への格下げはアプリ内で開かない", () => {
  assert.equal(decideNavigation("https://wearpos.ai-labo.cloud.evil.example/", APP), "external");
  assert.equal(decideNavigation("https://evil.example/?u=https://wearpos.ai-labo.cloud/", APP), "external");
  assert.equal(decideNavigation("http://wearpos.ai-labo.cloud/", APP), "external");
  assert.equal(decideNavigation("https://wearpos.ai-labo.cloud:8443/", APP), "external");
  assert.equal(decideNavigation("https://wearpos.ai-labo.cloud@evil.example/", APP), "external");
});

test("javascript: / data: / file: と壊れた URL は開かない", () => {
  assert.equal(decideNavigation("javascript:alert(1)", APP), "blocked");
  assert.equal(decideNavigation("data:text/html,<script>1</script>", APP), "blocked");
  assert.equal(decideNavigation("file:///etc/passwd", APP), "blocked");
  assert.equal(decideNavigation("not a url", APP), "blocked");
  assert.equal(decideNavigation("", APP), "blocked");
});

test("開発用の接続先 (http・ポート付き) でも同じ判定になる", () => {
  const dev = "http://192.168.1.10:3000";
  assert.equal(decideNavigation("http://192.168.1.10:3000/login", dev), "inside");
  assert.equal(decideNavigation("http://192.168.1.10:3001/login", dev), "external");
});

test("appPath はサーバー上のパスを絶対 URL にする", () => {
  assert.equal(appPath("/", APP), "https://wearpos.ai-labo.cloud/");
  assert.equal(appPath("/register", APP), "https://wearpos.ai-labo.cloud/register");
});
