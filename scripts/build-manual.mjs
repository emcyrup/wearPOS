/**
 * 操作マニュアルの PDF を作る。
 *
 *   npm run manual:build
 *
 * manual/manual.html をブラウザで開き、A4 で印刷したものを
 * manual/wearPOS_かんたん操作マニュアル.pdf として書き出す。
 * 文章を直すときは manual/manual.html を編集してから実行する。
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "manual", "manual.html");
const OUTPUT = join(ROOT, "manual", "wearPOS_かんたん操作マニュアル.pdf");

/** Playwright が同梱ブラウザを見つけられない環境向けのフォールバック */
const CHROMIUM_PATH = process.env.CHROMIUM_PATH;

if (!existsSync(SOURCE)) {
  console.error(`✗ ${SOURCE} がありません`);
  process.exit(1);
}

const browser = await chromium.launch(
  CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {},
);

try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(SOURCE).href, { waitUntil: "networkidle" });

  await page.pdf({
    path: OUTPUT,
    format: "A4",
    printBackground: true,
    margin: { top: "20mm", bottom: "20mm", left: "16mm", right: "16mm" },
    // ページ番号だけのシンプルなフッター (ヘッダーは空)
    displayHeaderFooter: true,
    headerTemplate: "<div></div>",
    footerTemplate: `
      <div style="width:100%;font-size:8pt;color:#8a8a99;padding:0 16mm;
                  font-family:sans-serif;display:flex;justify-content:space-between;">
        <span>wearPOS かんたん操作マニュアル</span>
        <span class="pageNumber"></span>
      </div>`,
  });

  console.log(`✓ ${OUTPUT}`);
} finally {
  await browser.close();
}
