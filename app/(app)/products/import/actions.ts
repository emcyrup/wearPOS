"use server";

import { revalidatePath } from "next/cache";

import { buildSku, sizeOrderOf } from "@/lib/apparel";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { applyStockMovement } from "@/lib/inventory";
import { defaultColorHex, parseProductCsv, parseSeasonCode, type CsvRow } from "@/lib/product-csv";
import { reserveAutoStyleCodes } from "@/lib/style-code";

export type ImportOptions = {
  /** 既にある品番・SKU の情報 (商品名・価格・JAN) を上書きするか */
  updateExisting: boolean;
  /** ブランド・カテゴリ・シーズンが無いときに自動で作るか */
  createMasters: boolean;
  /** 在庫数を入れる店舗。空なら在庫は動かさない */
  storeId: string;
};

/** 取込プレビューの 1 行 */
export type PreviewRow = {
  lineNo: number;
  styleCode: string;
  name: string;
  sku: string;
  colorName: string;
  sizeName: string;
  barcode: string;
  listPrice: number | null;
  stock: number | null;
  /** NEW=新規作成 / UPDATE=更新 / SKIP=変更なし (更新しない設定) / ERROR=取り込めない */
  status: "NEW" | "UPDATE" | "SKIP" | "ERROR";
  /** エラー内容 / 注意書き */
  messages: string[];
};

export type PreviewResult =
  | {
      ok: true;
      rows: PreviewRow[];
      counts: { new: number; update: number; skip: number; error: number };
      /** 自動で作られるマスタ */
      newMasters: { brands: string[]; categories: string[]; seasons: string[] };
    }
  | { ok: false; error: string };

/**
 * CSV を検証して取込結果のプレビューを作る。
 * DB は読むだけで、この時点では何も書き込まない。
 */
export async function previewProductCsv(
  csv: string,
  options: ImportOptions,
): Promise<PreviewResult> {
  if (!(await requireAdmin())) return { ok: false, error: "管理者のみ取り込めます" };

  const parsed = parseProductCsv(csv);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (parsed.rows.length === 0) return { ok: false, error: "取り込む行がありません" };
  if (parsed.rows.length > 2000) {
    return { ok: false, error: "一度に取り込めるのは 2000 行までです。分割してお試しください" };
  }

  const analysis = await analyze(parsed.rows, options);
  return {
    ok: true,
    rows: analysis.rows,
    counts: analysis.counts,
    newMasters: analysis.newMasters,
  };
}

export type ImportResult =
  | {
      ok: true;
      products: { created: number; updated: number };
      variants: { created: number; updated: number };
      barcodes: number;
      stock: number;
      skipped: number;
    }
  | { ok: false; error: string };

/**
 * CSV を実際に取り込む。
 * 品番ごとに商品を作り (または更新し)、カラー×サイズの SKU に JAN と在庫を設定する。
 */
export async function importProductCsv(
  csv: string,
  options: ImportOptions,
): Promise<ImportResult> {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: "管理者のみ取り込めます" };

  const parsed = parseProductCsv(csv);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (parsed.rows.length > 2000) {
    return { ok: false, error: "一度に取り込めるのは 2000 行までです。分割してお試しください" };
  }

  const analysis = await analyze(parsed.rows, options);
  if (analysis.counts.error > 0) {
    return {
      ok: false,
      error: `取り込めない行が ${analysis.counts.error} 件あります。内容を直してからもう一度お試しください`,
    };
  }
  const usable = analysis.rows.filter((row) => row.status === "NEW" || row.status === "UPDATE");
  if (usable.length === 0) return { ok: false, error: "取り込む行がありません" };

  const stats = {
    products: { created: 0, updated: 0 },
    variants: { created: 0, updated: 0 },
    barcodes: 0,
    stock: 0,
    skipped: analysis.counts.skip,
  };

  try {
    // マスタ (ブランド・カテゴリ・シーズン) を先に揃える
    const masters = await ensureMasters(parsed.rows, options);
    if ("error" in masters) return { ok: false, error: masters.error };

    const usableLineNos = new Set(usable.map((row) => row.lineNo));
    const byStyle = groupByStyle(parsed.rows.filter((row) => usableLineNos.has(row.lineNo)));

    // 品番が空の商品は、この取込のなかで自動採番する
    const autoStyleCodes = await reserveAutoStyleCodes(
      [...byStyle.values()].filter((rows) => !rows[0].styleCode).length,
    );
    let autoAt = 0;

    for (const rows of byStyle.values()) {
      const head = rows[0];
      const styleCode = head.styleCode || autoStyleCodes[autoAt++];
      const existing = await prisma.product.findUnique({
        where: { styleCode },
        include: { variants: true },
      });

      const listPrice = head.listPrice ?? 0;
      const currentPrice = head.currentPrice ?? listPrice;

      let productId: string;
      if (!existing) {
        const created = await prisma.product.create({
          data: {
            styleCode,
            name: head.name,
            brandId: masters.brands.get(masterKey(head.brand))!,
            categoryId: masters.categories.get(masterKey(head.category))!,
            seasonId: masters.seasons.get(masterKey(head.season))!,
            listPrice,
            currentPrice,
            costPrice: head.costPrice ?? 0,
            material: head.material || null,
            originCountry: head.originCountry || null,
          },
        });
        productId = created.id;
        stats.products.created++;
      } else {
        productId = existing.id;
        if (options.updateExisting) {
          await prisma.product.update({
            where: { id: existing.id },
            data: {
              name: head.name,
              listPrice,
              currentPrice,
              ...(head.costPrice !== null ? { costPrice: head.costPrice } : {}),
              ...(head.material ? { material: head.material } : {}),
              ...(head.originCountry ? { originCountry: head.originCountry } : {}),
            },
          });
          // 価格が変わったときは値下げ履歴を残す (画面の価格改定履歴と同じ扱い)
          if (existing.currentPrice !== currentPrice) {
            await prisma.priceChange.create({
              data: {
                productId: existing.id,
                fromPrice: existing.currentPrice,
                toPrice: currentPrice,
                reason: "CORRECTION",
                note: "CSV 一括取込による更新",
                changedBy: user.name || user.username,
              },
            });
          }
          stats.products.updated++;
        }
      }

      for (const row of rows) {
        const sku = buildSku(styleCode, row.colorSkuPart, row.sizeCode);
        const variant = await prisma.productVariant.findUnique({ where: { sku } });

        if (!variant) {
          const created = await prisma.productVariant.create({
            data: {
              productId,
              sku,
              colorCode: row.colorCode,
              colorName: row.colorName,
              colorHex: row.colorHex || defaultColorHex(row.colorName),
              sizeCode: row.sizeCode,
              sizeName: row.sizeName,
              sizeOrder: sizeOrderOf(row.sizeCode),
              barcode: row.barcode || null,
            },
          });
          stats.variants.created++;
          if (row.barcode) stats.barcodes++;
          await applyStock(created.id, row, options, user.name || user.username, stats);
        } else {
          if (options.updateExisting) {
            await prisma.productVariant.update({
              where: { id: variant.id },
              data: {
                colorName: row.colorName,
                sizeName: row.sizeName,
                ...(row.colorHex ? { colorHex: row.colorHex } : {}),
                ...(row.barcode ? { barcode: row.barcode } : {}),
              },
            });
            stats.variants.updated++;
            if (row.barcode && row.barcode !== variant.barcode) stats.barcodes++;
          } else if (row.barcode && !variant.barcode) {
            // 更新しない設定でも、JAN が未設定のときだけは埋める (値札の付け替えを不要にする)
            await prisma.productVariant.update({
              where: { id: variant.id },
              data: { barcode: row.barcode },
            });
            stats.barcodes++;
          }
          await applyStock(variant.id, row, options, user.name || user.username, stats);
        }
      }
    }
  } catch (error) {
    console.error("CSV 取込に失敗しました", error);
    return { ok: false, error: "取込に失敗しました。内容を確認して、もう一度お試しください" };
  }

  revalidatePath("/products");
  revalidatePath("/inventory");

  return { ok: true, ...stats };
}

/** 在庫数の指定があれば入荷として計上する */
async function applyStock(
  variantId: string,
  row: CsvRow,
  options: ImportOptions,
  actor: string,
  stats: { stock: number },
) {
  if (!options.storeId || row.stock === null || row.stock <= 0) return;
  await prisma.$transaction(async (tx) => {
    await applyStockMovement(tx, {
      storeId: options.storeId,
      variantId,
      type: "INBOUND",
      quantity: row.stock!,
      reason: `CSV 一括取込 (${actor})`,
    });
  });
  stats.stock += row.stock;
}

/** マスタ名の突き合わせは大文字小文字と前後の空白を無視する */
const masterKey = (value: string) => value.trim().toUpperCase();

/**
 * 1商品にまとめる単位。
 * 品番があればそれ、無ければ商品名でまとめる (品番は取込時に自動採番する)
 */
const groupKeyOf = (row: CsvRow) => row.styleCode || `名称:${row.name}`;

function groupByStyle(rows: CsvRow[]): Map<string, CsvRow[]> {
  const map = new Map<string, CsvRow[]>();
  for (const row of rows) {
    const key = groupKeyOf(row);
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return map;
}

/**
 * CSV の各行が「新規 / 更新 / 変更なし / エラー」のどれになるかを判定する。
 * ここでは DB を読むだけで書き込みはしない。
 */
async function analyze(rows: CsvRow[], options: ImportOptions) {
  const styleCodes = [...new Set(rows.map((row) => row.styleCode).filter(Boolean))];
  const barcodes = [...new Set(rows.map((row) => row.barcode).filter(Boolean))];

  const [products, brands, categories, seasons, barcodeOwners] = await Promise.all([
    prisma.product.findMany({
      where: { styleCode: { in: styleCodes } },
      include: { variants: { select: { sku: true, barcode: true } } },
    }),
    prisma.brand.findMany(),
    prisma.category.findMany(),
    prisma.season.findMany(),
    prisma.productVariant.findMany({
      where: { barcode: { in: barcodes } },
      select: { sku: true, barcode: true },
    }),
  ]);

  const productByStyle = new Map(products.map((product) => [product.styleCode, product]));
  const skuOwner = new Map(
    products.flatMap((product) => product.variants.map((v) => [v.sku, v] as const)),
  );
  const barcodeOwnerBySku = new Map(
    barcodeOwners.map((variant) => [variant.barcode as string, variant.sku]),
  );

  const hasMaster = (list: { code: string; name: string }[], value: string) =>
    value !== "" &&
    list.some(
      (row) => masterKey(row.code) === masterKey(value) || masterKey(row.name) === masterKey(value),
    );

  const newBrands = new Set<string>();
  const newCategories = new Set<string>();
  const newSeasons = new Set<string>();

  // ファイル内での重複を先に洗い出す
  const skuSeen = new Map<string, number>();
  const barcodeSeen = new Map<string, number>();

  const preview: PreviewRow[] = rows.map((row) => {
    // errors = 取り込めない理由 / notes = 取り込むけれど知らせたいこと
    const errors = [...row.errors];
    const notes: string[] = [];
    // 品番が空の行は取込時に自動採番するため、この時点では SKU が決まらない
    const sku =
      row.styleCode && row.sizeCode
        ? buildSku(row.styleCode, row.colorSkuPart, row.sizeCode)
        : "";
    const product = row.styleCode ? productByStyle.get(row.styleCode) : undefined;
    const isNewProduct = !product;

    // 同じ CSV の中での重複。品番が空でも、商品名 + カラー + サイズが同じなら重複
    const dedupeKey = sku || `${groupKeyOf(row)}/${row.colorSkuPart}/${row.sizeCode}`;
    if (row.sizeCode) {
      const firstAt = skuSeen.get(dedupeKey);
      if (firstAt) errors.push(`${firstAt} 行目と同じ SKU です`);
      else skuSeen.set(dedupeKey, row.lineNo);
    }
    if (row.barcode) {
      const firstAt = barcodeSeen.get(row.barcode);
      if (firstAt) errors.push(`${firstAt} 行目と同じ JAN です`);
      else barcodeSeen.set(row.barcode, row.lineNo);
    }

    // すでに別の SKU が使っている JAN は登録できない
    const owner = row.barcode ? barcodeOwnerBySku.get(row.barcode) : undefined;
    if (owner && owner !== sku) {
      errors.push(`この JAN は既に ${owner} で使われています`);
    }

    // 新規の品番はマスタと上代がそろっている必要がある
    if (isNewProduct) {
      if (row.listPrice === null) errors.push("上代がありません (新規の品番には必要です)");
      for (const [value, list, bucket, label] of [
        [row.brand, brands, newBrands, "ブランド"],
        [row.category, categories, newCategories, "カテゴリ"],
        [row.season, seasons, newSeasons, "シーズン"],
      ] as const) {
        if (hasMaster(list, value)) continue;
        if (!value) {
          errors.push(`${label}がありません (新規の品番には必要です)`);
        } else if (!options.createMasters) {
          errors.push(`${label}「${value}」がマスタにありません`);
        } else if (label === "シーズン" && !parseSeasonCode(value)) {
          errors.push(`シーズン「${value}」は 2026SS のような形式で入力してください`);
        } else {
          bucket.add(value);
        }
      }
    }

    // 品番を書かなかった行は、取込のたびに新しい商品として登録される。
    // 同じファイルを二度取り込むと二重に増えるため、実行前に伝える
    if (!row.styleCode) {
      notes.push("品番を自動採番します (取り込むたびに新しい商品になります)");
    }
    if (!row.colorSkuPart) notes.push(`カラーは「${row.colorName}」で登録します`);

    const existingVariant = sku ? skuOwner.get(sku) : undefined;
    let status: PreviewRow["status"];
    if (errors.length > 0) {
      status = "ERROR";
    } else if (!existingVariant) {
      status = "NEW";
    } else if (options.updateExisting) {
      status = "UPDATE";
    } else if (row.barcode && !existingVariant.barcode) {
      // 更新しない設定でも、未設定の JAN は埋める
      status = "UPDATE";
      notes.push("JAN のみ設定します");
    } else {
      status = "SKIP";
      notes.push("登録済みのため変更しません");
    }

    return {
      lineNo: row.lineNo,
      styleCode: row.styleCode,
      name: row.name,
      sku,
      colorName: row.colorName,
      sizeName: row.sizeName,
      barcode: row.barcode,
      listPrice: row.listPrice,
      stock: row.stock,
      status,
      messages: status === "ERROR" ? errors : notes,
    };
  });

  return {
    rows: preview,
    counts: {
      new: preview.filter((row) => row.status === "NEW").length,
      update: preview.filter((row) => row.status === "UPDATE").length,
      skip: preview.filter((row) => row.status === "SKIP").length,
      error: preview.filter((row) => row.status === "ERROR").length,
    },
    newMasters: {
      brands: [...newBrands],
      categories: [...newCategories],
      seasons: [...newSeasons],
    },
  };
}

/**
 * CSV に出てくるブランド・カテゴリ・シーズンを解決する。
 * 無いものは (設定が有効なら) その場で作る。
 */
async function ensureMasters(
  rows: CsvRow[],
  options: ImportOptions,
): Promise<
  | { error: string }
  | { brands: Map<string, string>; categories: Map<string, string>; seasons: Map<string, string> }
> {
  const [brandRows, categoryRows, seasonRows] = await Promise.all([
    prisma.brand.findMany(),
    prisma.category.findMany(),
    prisma.season.findMany(),
  ]);

  const brands = new Map<string, string>();
  const categories = new Map<string, string>();
  const seasons = new Map<string, string>();
  for (const brand of brandRows) {
    brands.set(masterKey(brand.code), brand.id);
    brands.set(masterKey(brand.name), brand.id);
  }
  for (const category of categoryRows) {
    categories.set(masterKey(category.code), category.id);
    categories.set(masterKey(category.name), category.id);
  }
  for (const season of seasonRows) {
    seasons.set(masterKey(season.code), season.id);
    seasons.set(masterKey(season.name), season.id);
  }

  for (const row of rows) {
    if (row.brand && !brands.has(masterKey(row.brand))) {
      if (!options.createMasters) return { error: `ブランド「${row.brand}」がマスタにありません` };
      const created = await prisma.brand.create({
        data: { code: toMasterCode(row.brand), name: row.brand },
      });
      brands.set(masterKey(created.code), created.id);
      brands.set(masterKey(created.name), created.id);
    }
    if (row.category && !categories.has(masterKey(row.category))) {
      if (!options.createMasters) return { error: `カテゴリ「${row.category}」がマスタにありません` };
      const created = await prisma.category.create({
        data: { code: toMasterCode(row.category), name: row.category },
      });
      categories.set(masterKey(created.code), created.id);
      categories.set(masterKey(created.name), created.id);
    }
    if (row.season && !seasons.has(masterKey(row.season))) {
      if (!options.createMasters) return { error: `シーズン「${row.season}」がマスタにありません` };
      const parsedSeason = parseSeasonCode(row.season);
      if (!parsedSeason) {
        return { error: `シーズン「${row.season}」は 2026SS のような形式で入力してください` };
      }
      const { year, term } = parsedSeason;
      // 春夏は 2〜7月、秋冬は 8〜1月、通年は 1年間を既定の期間にする
      const startMonth = term === "SS" ? 1 : term === "AW" ? 7 : 0;
      const created = await prisma.season.create({
        data: {
          code: row.season,
          name: `${year}年 ${term === "SS" ? "春夏" : term === "AW" ? "秋冬" : "通年"}`,
          year,
          term,
          startsOn: new Date(Date.UTC(year, startMonth, 1)),
          endsOn: new Date(Date.UTC(term === "ALL" ? year + 1 : year, startMonth + 6, 0)),
        },
      });
      seasons.set(masterKey(created.code), created.id);
      seasons.set(masterKey(created.name), created.id);
    }
  }

  return { brands, categories, seasons };
}

/** マスタコードは半角英数字にそろえる (日本語名は先頭からローマ字化できないのでハッシュ) */
function toMasterCode(name: string): string {
  const ascii = name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
  if (ascii.length >= 2) return ascii;
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) % 1679616;
  return `M${hash.toString(36).toUpperCase().padStart(4, "0")}`;
}
