/**
 * バーコードの SVG 生成。
 *
 * - EAN-13 (JAN): 13桁の数字でチェックディジットが正しい場合に使う
 * - Code128 (コードB): SKU コードなど任意の文字列に使う
 *
 * どちらもサーバー側で純粋な文字列操作として生成するため、
 * 外部ライブラリやクライアント JavaScript を必要としない。
 */

// ---------------------------------------------------------------------------
// EAN-13
// ---------------------------------------------------------------------------

/** 左側 L コード (奇数パリティ) */
const EAN_L = [
  "0001101", "0011001", "0010011", "0111101", "0100011",
  "0110001", "0101111", "0111011", "0110111", "0001011",
];
/** 左側 G コード (偶数パリティ) */
const EAN_G = [
  "0100111", "0110011", "0011011", "0100001", "0011101",
  "0111001", "0000101", "0010001", "0001001", "0010111",
];
/** 右側 R コード */
const EAN_R = [
  "1110010", "1100110", "1101100", "1000010", "1011100",
  "1001110", "1010000", "1000100", "1001000", "1110100",
];
/** 先頭桁ごとの左側6桁のパリティ配置 (L/G) */
const EAN_PARITY = [
  "LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG",
  "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL",
];

/** EAN-13 のチェックディジットを計算する (先頭12桁を渡す) */
export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    const digit = first12.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  return (10 - (sum % 10)) % 10;
}

/** 13桁の数字でチェックディジットが正しいか */
export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  return ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/** EAN-13 をモジュール列 (1=バー, 0=スペース) に変換する */
function ean13Modules(code: string): string {
  const parity = EAN_PARITY[Number(code[0])];
  let modules = "101"; // 左ガードバー
  for (let i = 1; i <= 6; i += 1) {
    const digit = Number(code[i]);
    modules += parity[i - 1] === "L" ? EAN_L[digit] : EAN_G[digit];
  }
  modules += "01010"; // センターバー
  for (let i = 7; i <= 12; i += 1) {
    modules += EAN_R[Number(code[i])];
  }
  modules += "101"; // 右ガードバー
  return modules;
}

// ---------------------------------------------------------------------------
// Code128 (コードB)
// ---------------------------------------------------------------------------

/**
 * Code128 の値ごとのバー/スペース幅 (バー,スペース,... の6要素、合計11モジュール)。
 * 添字がシンボル値。103=StartA, 104=StartB, 105=StartC。
 */
const CODE128_WIDTHS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
  "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
  "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412",
  "211214", "211232",
];
const CODE128_STOP = "2331112";
const START_B = 104;

/** Code128 (コードB) をモジュール列に変換する。ASCII 32-126 のみ対応 */
function code128Modules(text: string): string {
  const values = [START_B];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) {
      throw new Error(`Code128(B) で扱えない文字が含まれています: ${ch}`);
    }
    values.push(code - 32);
  }

  // チェックシンボル: Start値 + Σ(値×位置) mod 103
  let checksum = START_B;
  for (let i = 1; i < values.length; i += 1) {
    checksum += values[i] * i;
  }
  values.push(checksum % 103);

  let modules = "";
  for (const value of values) {
    const widths = CODE128_WIDTHS[value];
    for (let i = 0; i < widths.length; i += 1) {
      modules += (i % 2 === 0 ? "1" : "0").repeat(Number(widths[i]));
    }
  }
  // 終端パターン
  for (let i = 0; i < CODE128_STOP.length; i += 1) {
    modules += (i % 2 === 0 ? "1" : "0").repeat(Number(CODE128_STOP[i]));
  }
  return modules;
}

// ---------------------------------------------------------------------------
// SVG 出力
// ---------------------------------------------------------------------------

export type BarcodeSvgOptions = {
  /** 1モジュールの幅 (px) */
  moduleWidth?: number;
  /** バーの高さ (px) */
  height?: number;
  /** 下部に人間可読のテキストを出すか */
  showText?: boolean;
  /** 左右の余白 (モジュール数) — スキャナが読み取るために必要 */
  quietZone?: number;
};

function modulesToSvg(
  modules: string,
  text: string,
  options: BarcodeSvgOptions = {},
): string {
  const moduleWidth = options.moduleWidth ?? 2;
  const height = options.height ?? 56;
  const quietZone = options.quietZone ?? 10;
  const showText = options.showText ?? true;

  const textHeight = showText ? 14 : 0;
  const width = (modules.length + quietZone * 2) * moduleWidth;
  const totalHeight = height + textHeight;

  const rects: string[] = [];
  let run = 0;
  for (let i = 0; i <= modules.length; i += 1) {
    if (i < modules.length && modules[i] === "1") {
      run += 1;
      continue;
    }
    if (run > 0) {
      const x = (quietZone + i - run) * moduleWidth;
      rects.push(
        `<rect x="${x}" y="0" width="${run * moduleWidth}" height="${height}" />`,
      );
      run = 0;
    }
  }

  const label = showText
    ? `<text x="${width / 2}" y="${height + 11}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="10">${escapeXml(text)}</text>`
    : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${totalHeight}" ` +
    `width="${width}" height="${totalHeight}" role="img" aria-label="バーコード ${escapeXml(text)}">` +
    `<rect x="0" y="0" width="${width}" height="${totalHeight}" fill="#ffffff" />` +
    `<g fill="#000000">${rects.join("")}</g>${label}</svg>`
  );
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * コードに応じて最適な形式でバーコード SVG を返す。
 * 13桁でチェックディジットの正しい数字なら EAN-13 (JAN)、それ以外は Code128。
 */
export function barcodeSvg(code: string, options: BarcodeSvgOptions = {}): string {
  const trimmed = code.trim();
  if (isValidEan13(trimmed)) {
    return modulesToSvg(ean13Modules(trimmed), trimmed, options);
  }
  return modulesToSvg(code128Modules(trimmed), trimmed, options);
}

/** どの形式で描画されるか (UI 表示用) */
export function barcodeFormat(code: string): "EAN-13" | "Code128" {
  return isValidEan13(code.trim()) ? "EAN-13" : "Code128";
}
