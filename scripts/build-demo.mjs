/**
 * GitHub Pages 用のデモサイトを生成する。
 *
 *   npm run demo:build
 *
 * アプリを一時的に起動し、各画面を描画済みの状態で取り込んで
 * docs/index.html に 1 枚の静的ページとして書き出す。
 * サーバー処理 (API・Server Actions) は動かないため、あくまで画面確認用。
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "docs");
const PORT = Number(process.env.DEMO_PORT ?? 3210);
const BASE = `http://localhost:${PORT}`;

/** Playwright が同梱ブラウザを見つけられない環境向けのフォールバック */
const CHROMIUM_PATH = process.env.CHROMIUM_PATH;

async function waitForServer(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      // 起動待ち
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`アプリが ${timeoutMs}ms 以内に起動しませんでした`);
}

const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
  cwd: ROOT,
  stdio: "ignore",
  detached: false,
});

let browser;
try {
  console.log(`アプリを起動中 (${BASE}) ...`);
  await waitForServer();

  browser = await chromium.launch(CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

  /** 一覧ページから最初の詳細ページの URL を拾う */
  async function firstDetailHref(listPath, pattern) {
    await page.goto(`${BASE}${listPath}`, { waitUntil: "networkidle" });
    return page.evaluate((p) => {
      const link = Array.from(document.querySelectorAll("a")).find((el) =>
        new RegExp(p).test(el.getAttribute("href") ?? ""),
      );
      return link?.getAttribute("href") ?? null;
    }, pattern);
  }

  const productHref = await firstDetailHref("/products", "^/products/[a-z0-9]{20,}$");
  const customerHref = await firstDetailHref("/customers", "^/customers/[a-z0-9]{20,}$");
  const saleHref = await firstDetailHref("/sales", "^/sales/[a-z0-9]{20,}$");

  const screens = [
    { id: "dashboard", label: "ダッシュボード", note: "直近30日の売上・顧客サマリ", path: "/" },
    { id: "products", label: "商品 / SKU", note: "品番一覧とシーズン・値下げ状況", path: "/products" },
    { id: "product", label: "商品詳細", note: "カラー×サイズ 在庫マトリクス", path: productHref },
    {
      id: "inventory",
      label: "在庫",
      note: "店舗×SKUの在庫と入出庫履歴",
      path: "/inventory?q=26SS-SH-001",
    },
    { id: "customers", label: "顧客一覧", note: "ランク・LINE連携・休眠の絞り込み", path: "/customers" },
    { id: "customer", label: "顧客詳細", note: "購買傾向・ポイント・LINE連携", path: customerHref },
    { id: "sales", label: "取引履歴", note: "POS連携で取り込んだ伝票", path: "/sales" },
    { id: "sale", label: "伝票詳細", note: "明細・お会計・連携情報", path: saleHref },
    { id: "settings", label: "設定 / 連携", note: "POS API と LINE の連携設定", path: "/settings" },
  ];

  const missing = screens.filter((screen) => !screen.path);
  if (missing.length) {
    throw new Error(`画面の URL を取得できませんでした: ${missing.map((s) => s.id).join(", ")}`);
  }

  // ビルド済みの CSS をそのまま埋め込む (外部リクエストを発生させない)
  const cssHrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((el) => el.getAttribute("href")),
  );
  let css = "";
  for (const href of cssHrefs) {
    const res = await page.request.get(`${BASE}${href}`);
    css += await res.text();
  }

  // アプリ内リンクを、取り込んだ画面への切り替えに読み替えるための対応表
  const linkMap = Object.fromEntries(
    screens.map((screen) => [screen.path.split("?")[0], screen.id]),
  );

  const captured = [];
  for (const screen of screens) {
    await page.goto(`${BASE}${screen.path}`, { waitUntil: "networkidle" });
    // グラフ (recharts) はクライアント描画なので、SVG が出揃うまで待つ
    await page.waitForTimeout(1200);

    const html = await page.evaluate((map) => {
      const main = document.querySelector("main");
      if (!main) return "";
      const clone = main.cloneNode(true);

      for (const anchor of clone.querySelectorAll("a")) {
        const href = (anchor.getAttribute("href") ?? "").split("?")[0];
        anchor.removeAttribute("href");
        const target = map[href];
        if (target) {
          // 取り込み済みの画面へはタブ切り替えで遷移させる
          anchor.setAttribute("data-goto", target);
        } else {
          anchor.setAttribute("data-static-link", "");
        }
      }

      for (const script of clone.querySelectorAll("script")) script.remove();
      return clone.innerHTML;
    }, linkMap);

    captured.push({ ...screen, html });
    console.log(`  取り込み: ${screen.id} (${(html.length / 1024).toFixed(0)} KB)`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "index.html"), renderPage({ css, screens: captured }));
  // GitHub Pages の Jekyll 処理を無効化する
  writeFileSync(join(OUT_DIR, ".nojekyll"), "");

  console.log(`\ndocs/index.html を生成しました。`);
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}

function renderPage({ css, screens }) {
  const tabs = screens
    .map(
      (screen, i) =>
        `<button class="tab" type="button" role="tab" id="tab-${screen.id}" aria-controls="screen-${screen.id}" aria-selected="${i === 0}" data-target="${screen.id}">${screen.label}</button>`,
    )
    .join("\n      ");

  const panels = screens
    .map(
      (screen, i) => `<section class="screen" id="screen-${screen.id}" role="tabpanel" aria-labelledby="tab-${screen.id}"${i === 0 ? "" : " hidden"}>
  <p class="screen-note"><span class="screen-note-label">${screen.label}</span>${screen.note}</p>
  <div class="canvas"><div class="canvas-inner">${screen.html}</div></div>
</section>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>wearPOS — 画面デモ</title>
<meta name="description" content="アパレル向け顧客管理 / POSレジ連携アプリ wearPOS の画面デモ" />
<style>
/* ---- アプリ本体のスタイル (ビルド済み CSS をそのまま埋め込み) ---- */
${css}

/* ---- デモビューアの外枠 ---- */
:root {
  --v-bg: #ffffff;
  --v-chrome: #16161c;
  --v-chrome-text: #f6f6f7;
  --v-chrome-muted: #8a8a99;
  --v-chrome-line: #33333d;
  --v-accent: #b4544a;
  --v-note: #4b4b57;
  --v-note-bg: #f2f2f4;
  --v-frame: #d6d6dc;
}
@media (prefers-color-scheme: dark) {
  :root {
    --v-bg: #0e0e12;
    --v-chrome: #05050a;
    --v-chrome-line: #2a2a34;
    --v-note: #a6a6b2;
    --v-note-bg: #17171d;
    --v-frame: #2a2a34;
  }
}
html, body { height: auto; }
body { background-color: var(--v-bg); margin: 0; padding: 0; }

.viewer-bar {
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--v-chrome);
  color: var(--v-chrome-text);
  border-bottom: 1px solid var(--v-chrome-line);
}
.viewer-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 0.9rem;
  padding: 0.85rem 1.25rem 0.6rem;
}
.viewer-brand { font-size: 0.95rem; font-weight: 700; }
.viewer-brand em { font-style: normal; color: var(--v-accent); }
.viewer-sub { font-size: 0.72rem; color: var(--v-chrome-muted); letter-spacing: 0.04em; }
.viewer-badge {
  margin-left: auto;
  font-size: 0.68rem;
  letter-spacing: 0.06em;
  color: var(--v-chrome-muted);
  border: 1px solid var(--v-chrome-line);
  border-radius: 999px;
  padding: 0.15rem 0.6rem;
  white-space: nowrap;
}
.tabs {
  display: flex;
  gap: 0.25rem;
  overflow-x: auto;
  padding: 0 1rem 0.7rem;
  scrollbar-width: thin;
}
.tab {
  flex: 0 0 auto;
  appearance: none;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 7px;
  color: var(--v-chrome-muted);
  font: inherit;
  font-size: 0.8rem;
  padding: 0.35rem 0.75rem;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.15s, background-color 0.15s, border-color 0.15s;
}
.tab:hover { color: var(--v-chrome-text); background: rgba(255, 255, 255, 0.06); }
.tab[aria-selected="true"] { color: #fff; background: var(--v-accent); border-color: var(--v-accent); }
.tab:focus-visible { outline: 2px solid var(--v-accent); outline-offset: 2px; }

.screen-note {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem;
  max-width: 1180px;
  margin: 1.1rem auto 0.65rem;
  padding: 0.5rem 0.85rem;
  background: var(--v-note-bg);
  border-radius: 8px;
  color: var(--v-note);
  font-size: 0.78rem;
  line-height: 1.5;
}
.screen-note-label { font-weight: 600; color: var(--v-accent); }

/* アプリ画面はライト UI なので、テーマに関わらず本来の地色で見せる */
.canvas {
  max-width: 1180px;
  margin: 0 auto 2.5rem;
  border: 1px solid var(--v-frame);
  border-radius: 12px;
  overflow: hidden;
  background: #f6f6f7;
  color: #16161c;
}
.canvas-inner { display: block; padding: 1.5rem 1.75rem 2rem; }

/* 静的デモのため、フォーム操作はできない。画面遷移リンクのみ有効 */
.canvas input, .canvas select, .canvas textarea, .canvas button { pointer-events: none; }
.canvas a[data-static-link] { pointer-events: none; cursor: default; }
.canvas a[data-goto] { cursor: pointer; }

@media (max-width: 640px) {
  .canvas-inner { padding: 1rem 0.9rem 1.5rem; }
  .screen-note, .canvas { margin-left: 0.6rem; margin-right: 0.6rem; }
}
@media (prefers-reduced-motion: reduce) {
  .tab { transition: none; }
}
</style>
</head>
<body>
<div class="viewer-bar">
  <div class="viewer-head">
    <span class="viewer-brand">wear<em>POS</em></span>
    <span class="viewer-sub">アパレル向け 顧客管理 / POSレジ連携</span>
    <span class="viewer-badge">画面デモ — 実データ表示・サーバー処理は動作しません</span>
  </div>
  <div class="tabs" role="tablist" aria-label="画面">
      ${tabs}
  </div>
</div>

${panels}

<script>
  const tabs = Array.from(document.querySelectorAll(".tab"));
  const screens = Array.from(document.querySelectorAll(".screen"));

  function show(id, updateHash = true) {
    if (!screens.some((screen) => screen.id === "screen-" + id)) return;
    for (const tab of tabs) tab.setAttribute("aria-selected", String(tab.dataset.target === id));
    for (const screen of screens) screen.hidden = screen.id !== "screen-" + id;
    if (updateHash && location.hash.slice(1) !== id) location.hash = id;
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  for (const tab of tabs) {
    tab.addEventListener("click", () => show(tab.dataset.target));
  }

  // 戻る/進む操作や URL のハッシュ変更に追従する
  window.addEventListener("hashchange", () => show(location.hash.slice(1), false));

  // アプリ画面内のリンクからも切り替えられるようにする
  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-goto]");
    if (!link) return;
    event.preventDefault();
    show(link.dataset.goto);
  });

  if (location.hash) show(location.hash.slice(1));
</script>
</body>
</html>
`;
}
