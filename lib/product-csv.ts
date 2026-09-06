import { NO_COLOR, STANDARD_COLORS } from "@/lib/apparel";

/**
 * 商品 CSV の解析。
 *
 * 仕入先からもらった JAN 付きの商品リスト (品番・商品名・上代・カラー・サイズ・JAN) を
 * そのまま取り込めるようにする。画面 (プレビュー) とサーバー (取込) の両方から同じ解析を
 * 使うため、DB に依存しない純粋な関数だけを置く。
 */

/** 取り込める列。日本語の見出しでも英語の見出しでも受け付ける */
export const CSV_COLUMNS = {
  styleCode: ["品番", "品番コード", "スタイルコード", "stylecode", "style_code", "style"],
  name: ["商品名", "品名", "name", "productname", "product_name"],
  brand: ["ブランド", "brand"],
  category: ["カテゴリ", "カテゴリー", "分類", "category"],
  season: ["シーズン", "season"],
  listPrice: ["上代", "定価", "プロパー価格", "本体価格", "listprice", "list_price", "price"],
  currentPrice: ["販売価格", "売価", "現在価格", "currentprice", "current_price", "sellingprice"],
  costPrice: ["原価", "仕入値", "仕入価格", "costprice", "cost_price", "cost"],
  colorCode: ["カラーコード", "色コード", "colorcode", "color_code"],
  colorName: ["カラー", "カラー名", "色", "color", "colorname", "color_name"],
  colorHex: ["カラーHEX", "色見本", "colorhex", "color_hex", "hex"],
  sizeCode: ["サイズ", "サイズコード", "size", "sizecode", "size_code"],
  sizeName: ["サイズ名", "sizename", "size_name"],
  barcode: ["JAN", "JANコード", "バーコード", "jan", "jancode", "barcode", "ean"],
  stock: ["在庫数", "在庫", "数量", "stock", "quantity", "qty"],
  material: ["素材", "組成", "material"],
  originCountry: ["原産国", "生産国", "origin", "origincountry", "origin_country"],
} as const;

export type CsvColumnKey = keyof typeof CSV_COLUMNS;

/** 見出しの表示名 (画面のガイドに使う) */
export const CSV_COLUMN_LABEL: Record<CsvColumnKey, string> = {
  styleCode: "品番",
  name: "商品名",
  brand: "ブランド",
  category: "カテゴリ",
  season: "シーズン",
  listPrice: "上代",
  currentPrice: "販売価格",
  costPrice: "原価",
  colorCode: "カラーコード",
  colorName: "カラー",
  colorHex: "カラーHEX",
  sizeCode: "サイズ",
  sizeName: "サイズ名",
  barcode: "JAN",
  stock: "在庫数",
  material: "素材",
  originCountry: "原産国",
};

/**
 * 取込に最低限必要な列。
 * 品番とカラーは任意 (品番は自動採番、カラーは「指定なし」として扱う)
 */
export const REQUIRED_COLUMNS: CsvColumnKey[] = ["name", "listPrice", "sizeCode"];

export type CsvRow = {
  /** CSV の行番号 (見出しを 1 行目とした実際の行番号) */
  lineNo: number;
  styleCode: string;
  name: string;
  brand: string;
  category: string;
  season: string;
  listPrice: number | null;
  currentPrice: number | null;
  costPrice: number | null;
  colorCode: string;
  colorName: string;
  /** SKU に入れるカラーの部分。カラーを分けない商品では空 */
  colorSkuPart: string;
  colorHex: string;
  sizeCode: string;
  sizeName: string;
  barcode: string;
  stock: number | null;
  material: string;
  originCountry: string;
  /** この行だけで判定できるエラー (必須漏れ・数値の形式など) */
  errors: string[];
};

export type ParseResult =
  | { ok: true; rows: CsvRow[]; missingColumns: CsvColumnKey[] }
  | { ok: false; error: string };

/** ダブルクォート・カンマ・改行に対応した最小限の CSV パーサ */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  // BOM と改行コードのゆらぎを先に正規化する
  const source = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === "," || char === "\t") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  rows.push(row);

  // 末尾の空行を落とす
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

/** 見出しの表記ゆれを吸収するためのキー化 */
const normalizeHeader = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s_()（）]/g, "")
    .replace(/[（(].*?[）)]/g, "");

/** 「¥1,200」「1200円」なども数値として読む */
function parseNumber(value: string): number | null {
  const cleaned = value.replace(/[¥￥,，\s円]/g, "").trim();
  if (cleaned === "") return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? Math.round(num) : null;
}

/**
 * CSV のテキストを行の配列にする。
 * 行ごとの必須チェックまで行い、DB を見ないと分からない検証 (重複・マスタの有無) は
 * 取込側で行う。
 */
export function parseProductCsv(text: string): ParseResult {
  const table = parseCsv(text);
  if (table.length === 0) return { ok: false, error: "CSV が空です" };
  if (table.length === 1) {
    return { ok: false, error: "見出し行しかありません。商品の行を追加してください" };
  }

  const header = table[0].map(normalizeHeader);
  const indexOf = (key: CsvColumnKey) => {
    for (const alias of CSV_COLUMNS[key]) {
      const at = header.indexOf(normalizeHeader(alias));
      if (at >= 0) return at;
    }
    return -1;
  };

  const columnIndex = Object.fromEntries(
    (Object.keys(CSV_COLUMNS) as CsvColumnKey[]).map((key) => [key, indexOf(key)]),
  ) as Record<CsvColumnKey, number>;

  const missingColumns = REQUIRED_COLUMNS.filter((key) => columnIndex[key] < 0);
  if (missingColumns.length > 0) {
    return {
      ok: false,
      error: `見出しに ${missingColumns
        .map((key) => CSV_COLUMN_LABEL[key])
        .join("・")} の列がありません`,
    };
  }

  const cell = (cells: string[], key: CsvColumnKey) => {
    const at = columnIndex[key];
    return at >= 0 ? (cells[at] ?? "").trim() : "";
  };

  const rows: CsvRow[] = table.slice(1).map((cells, index) => {
    const lineNo = index + 2;
    const listPriceRaw = cell(cells, "listPrice");
    const currentPriceRaw = cell(cells, "currentPrice");
    const costPriceRaw = cell(cells, "costPrice");
    const stockRaw = cell(cells, "stock");

    const colorName = cell(cells, "colorName");
    const sizeCode = cell(cells, "sizeCode");
    const row: CsvRow = {
      lineNo,
      styleCode: cell(cells, "styleCode").toUpperCase(),
      name: cell(cells, "name"),
      brand: cell(cells, "brand"),
      category: cell(cells, "category"),
      season: cell(cells, "season").toUpperCase(),
      listPrice: parseNumber(listPriceRaw),
      currentPrice: parseNumber(currentPriceRaw),
      costPrice: parseNumber(costPriceRaw),
      // カラーコードが無ければカラー名から作る (標準カラーは商品登録画面と同じコード)。
      // カラー自体が無い商品 (小物・雑貨など) は「指定なし」1つとして扱う
      colorCode: (
        cell(cells, "colorCode") ||
        (colorName ? defaultColorCode(colorName) : NO_COLOR.code)
      ).toUpperCase(),
      colorName: colorName || NO_COLOR.name,
      colorSkuPart: colorName
        ? (cell(cells, "colorCode") || defaultColorCode(colorName)).toUpperCase()
        : "",
      colorHex: cell(cells, "colorHex"),
      sizeCode: sizeCode.toUpperCase(),
      sizeName: cell(cells, "sizeName") || sizeCode,
      barcode: cell(cells, "barcode"),
      stock: parseNumber(stockRaw),
      material: cell(cells, "material"),
      originCountry: cell(cells, "originCountry"),
      errors: [],
    };

    // 品番とカラーは任意。品番なしの行は商品名でまとめて自動採番する
    if (row.styleCode && !/^[A-Za-z0-9-]+$/.test(row.styleCode)) {
      row.errors.push("品番は半角英数字とハイフンで入力してください");
    }
    if (!row.name) row.errors.push("商品名がありません");
    if (!row.sizeCode) row.errors.push("サイズがありません");
    if (listPriceRaw !== "" && row.listPrice === null) row.errors.push("上代が数値ではありません");
    if (row.listPrice !== null && row.listPrice < 0) row.errors.push("上代がマイナスです");
    if (currentPriceRaw !== "" && row.currentPrice === null) {
      row.errors.push("販売価格が数値ではありません");
    }
    if (costPriceRaw !== "" && row.costPrice === null) row.errors.push("原価が数値ではありません");
    if (stockRaw !== "" && row.stock === null) row.errors.push("在庫数が数値ではありません");
    if (row.stock !== null && row.stock < 0) row.errors.push("在庫数がマイナスです");
    if (row.barcode && !/^[A-Za-z0-9._-]+$/.test(row.barcode)) {
      row.errors.push("JAN は英数字・ハイフンで入力してください");
    }

    return row;
  });

  return { ok: true, rows, missingColumns: [] };
}

/**
 * カラーコードが無いときの既定値。
 * 標準カラー (ホワイト・ネイビーなど) は商品登録画面と同じコードを使い、
 * 画面から登録した SKU と CSV から取り込んだ SKU が同じ形になるようにする。
 */
function defaultColorCode(colorName: string): string {
  const standard = STANDARD_COLORS.find((color) => color.name === colorName.trim());
  if (standard) return standard.code;

  const ascii = colorName.replace(/[^A-Za-z0-9]/g, "");
  if (ascii.length >= 2) return ascii.slice(0, 6);

  // それ以外の日本語のカラー名は、名前から安定したコードを作る (同じ名前なら同じコード)
  let hash = 0;
  for (const char of colorName) hash = (hash * 31 + char.codePointAt(0)!) % 46656;
  return `C${hash.toString(36).toUpperCase().padStart(3, "0")}`;
}

/** 標準カラーの色見本。CSV に色見本の指定が無いときに使う */
export function defaultColorHex(colorName: string): string | null {
  return STANDARD_COLORS.find((color) => color.name === colorName.trim())?.hex ?? null;
}

/** シーズンコード (2026SS) から年と期を読む */
export function parseSeasonCode(code: string): { year: number; term: string } | null {
  const match = code.trim().toUpperCase().match(/^(\d{4})\s*(SS|AW|ALL)$/);
  if (!match) return null;
  return { year: Number(match[1]), term: match[2] };
}

/** 取込サンプル (画面に貼り付けの見本として出す) */
export const CSV_SAMPLE = [
  "品番,商品名,ブランド,カテゴリ,シーズン,上代,販売価格,カラー,サイズ,JAN,在庫数",
  "26SS-CT-900,リネンシャツ,URBAN,TOPS,2026SS,12000,12000,ホワイト,M,4901234567894,3",
  "26SS-CT-900,リネンシャツ,URBAN,TOPS,2026SS,12000,12000,ホワイト,L,4901234567900,2",
  "26SS-CT-900,リネンシャツ,URBAN,TOPS,2026SS,12000,12000,ネイビー,M,4901234567917,1",
].join("\n");
