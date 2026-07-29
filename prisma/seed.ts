import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import "dotenv/config";

import { buildSku, calcEarnedPoints, rankForSpent, sizeOrderOf } from "../lib/apparel";

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" });
const prisma = new PrismaClient({ adapter });

/** 再現性のある擬似乱数 (シードを固定して毎回同じデータを作る) */
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}
const rand = makeRandom(20260729);

const pick = <T,>(items: T[]): T => items[Math.floor(rand() * items.length)];
const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

const COLORS = [
  { code: "BLK", name: "ブラック", hex: "#1c1c1e" },
  { code: "WHT", name: "ホワイト", hex: "#f4f2ee" },
  { code: "NVY", name: "ネイビー", hex: "#2b3550" },
  { code: "BEG", name: "ベージュ", hex: "#cfbea4" },
  { code: "GRY", name: "グレー", hex: "#9a9a9f" },
  { code: "KHK", name: "カーキ", hex: "#6b6b4b" },
  { code: "PNK", name: "ピンク", hex: "#e2b5b8" },
  { code: "BLU", name: "ブルー", hex: "#4a7ba7" },
];

const TOPS_SIZES = ["XS", "S", "M", "L", "XL"];
const FREE_SIZES = ["F"];
const BOTTOM_SIZES = ["S", "M", "L"];

type ProductSpec = {
  styleCode: string;
  name: string;
  categoryCode: string;
  listPrice: number;
  cost: number;
  sizes: string[];
  colors: string[];
  material: string;
  seasonCode: string;
  /** セール中のシーズン商品は値下げ後価格を持つ */
  currentPrice?: number;
};

const PRODUCTS: ProductSpec[] = [
  // --- 2026SS (今季・プロパー) ---
  { styleCode: "26SS-SH-001", name: "コットンオーバーシャツ", categoryCode: "SHIRT", listPrice: 12800, cost: 4200, sizes: TOPS_SIZES, colors: ["BLK", "WHT", "BEG", "NVY"], material: "コットン100%", seasonCode: "2026SS" },
  { styleCode: "26SS-CS-002", name: "リネンブレンドカーディガン", categoryCode: "KNIT", listPrice: 16800, cost: 5600, sizes: TOPS_SIZES, colors: ["BEG", "NVY", "GRY"], material: "リネン55% コットン45%", seasonCode: "2026SS" },
  { styleCode: "26SS-OP-003", name: "サテンフレアワンピース", categoryCode: "ONEPIECE", listPrice: 22800, cost: 7400, sizes: BOTTOM_SIZES, colors: ["BLK", "PNK", "NVY"], material: "ポリエステル100%", seasonCode: "2026SS" },
  { styleCode: "26SS-PT-004", name: "テーパードイージーパンツ", categoryCode: "PANTS", listPrice: 14800, cost: 4900, sizes: BOTTOM_SIZES, colors: ["BLK", "KHK", "BEG"], material: "コットン70% ポリエステル30%", seasonCode: "2026SS" },
  { styleCode: "26SS-TS-005", name: "オーガニックコットンTシャツ", categoryCode: "CUTSEW", listPrice: 6800, cost: 1900, sizes: TOPS_SIZES, colors: ["WHT", "BLK", "GRY", "BLU"], material: "オーガニックコットン100%", seasonCode: "2026SS" },
  { styleCode: "26SS-BG-006", name: "レザートートバッグ", categoryCode: "BAG", listPrice: 28000, cost: 9800, sizes: FREE_SIZES, colors: ["BLK", "BEG"], material: "牛革", seasonCode: "2026SS" },

  // --- 2025AW (セール中: 値下げ済み) ---
  { styleCode: "25AW-CT-101", name: "ウールチェスターコート", categoryCode: "OUTER", listPrice: 48000, cost: 16000, sizes: TOPS_SIZES, colors: ["BLK", "GRY", "BEG"], material: "ウール80% ナイロン20%", seasonCode: "2025AW", currentPrice: 24000 },
  { styleCode: "25AW-KN-102", name: "ローゲージタートルニット", categoryCode: "KNIT", listPrice: 18800, cost: 6200, sizes: TOPS_SIZES, colors: ["NVY", "GRY", "PNK"], material: "ウール100%", seasonCode: "2025AW", currentPrice: 9400 },
  { styleCode: "25AW-SK-103", name: "ウールプリーツスカート", categoryCode: "SKIRT", listPrice: 16800, cost: 5400, sizes: BOTTOM_SIZES, colors: ["BLK", "KHK"], material: "ウール60% ポリエステル40%", seasonCode: "2025AW", currentPrice: 8400 },

  // --- 通年 (定番) ---
  { styleCode: "ALL-TS-201", name: "定番クルーネックTシャツ", categoryCode: "CUTSEW", listPrice: 4800, cost: 1200, sizes: TOPS_SIZES, colors: ["WHT", "BLK", "NVY", "GRY"], material: "コットン100%", seasonCode: "2026ALL" },
  { styleCode: "ALL-DN-202", name: "ストレートデニムパンツ", categoryCode: "PANTS", listPrice: 15800, cost: 5100, sizes: BOTTOM_SIZES, colors: ["BLU", "BLK"], material: "コットン99% ポリウレタン1%", seasonCode: "2026ALL" },
  { styleCode: "ALL-AC-203", name: "シルクスカーフ", categoryCode: "ACC", listPrice: 9800, cost: 3100, sizes: FREE_SIZES, colors: ["PNK", "NVY", "BEG"], material: "シルク100%", seasonCode: "2026ALL" },
];

const CUSTOMER_NAMES: [string, string, string, string, string][] = [
  ["佐藤", "美咲", "サトウ", "ミサキ", "FEMALE"],
  ["鈴木", "陽菜", "スズキ", "ヒナ", "FEMALE"],
  ["高橋", "健太", "タカハシ", "ケンタ", "MALE"],
  ["田中", "さくら", "タナカ", "サクラ", "FEMALE"],
  ["伊藤", "翔太", "イトウ", "ショウタ", "MALE"],
  ["渡辺", "結衣", "ワタナベ", "ユイ", "FEMALE"],
  ["山本", "大輔", "ヤマモト", "ダイスケ", "MALE"],
  ["中村", "彩", "ナカムラ", "アヤ", "FEMALE"],
  ["小林", "遥", "コバヤシ", "ハルカ", "FEMALE"],
  ["加藤", "拓也", "カトウ", "タクヤ", "MALE"],
  ["吉田", "愛", "ヨシダ", "アイ", "FEMALE"],
  ["山田", "真央", "ヤマダ", "マオ", "FEMALE"],
  ["佐々木", "涼", "ササキ", "リョウ", "MALE"],
  ["松本", "杏", "マツモト", "アン", "FEMALE"],
  ["井上", "千夏", "イノウエ", "チナツ", "FEMALE"],
  ["木村", "隼人", "キムラ", "ハヤト", "MALE"],
  ["林", "美穂", "ハヤシ", "ミホ", "FEMALE"],
  ["清水", "楓", "シミズ", "カエデ", "FEMALE"],
  ["山口", "健", "ヤマグチ", "ケン", "MALE"],
  ["斎藤", "菜々", "サイトウ", "ナナ", "FEMALE"],
  ["池田", "優花", "イケダ", "ユウカ", "FEMALE"],
  ["橋本", "亮", "ハシモト", "リョウ", "MALE"],
  ["石川", "咲", "イシカワ", "サキ", "FEMALE"],
  ["前田", "詩織", "マエダ", "シオリ", "FEMALE"],
];

const TAG_POOL = [
  "カジュアル", "モノトーン", "きれいめ", "ナチュラル", "トレンド重視",
  "セール狙い", "新作チェック", "アウター好き", "小物好き", "リネン好み",
];

async function main() {
  console.log("既存データを削除中...");
  // 依存関係の順に削除
  await prisma.lineMessageLog.deleteMany();
  await prisma.lineLinkToken.deleteMany();
  await prisma.lineAccount.deleteMany();
  await prisma.pointEvent.deleteMany();
  await prisma.saleLine.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.stockTransferLine.deleteMany();
  await prisma.stockTransfer.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.inventory.deleteMany();
  await prisma.priceChange.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();
  await prisma.season.deleteMany();
  await prisma.category.deleteMany();
  await prisma.brand.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.staff.deleteMany();
  await prisma.store.deleteMany();

  console.log("店舗・スタッフを作成中...");
  const stores = await Promise.all(
    [
      { code: "SHIBUYA", name: "渋谷店", phone: "03-1234-5678", address: "東京都渋谷区神南1-1-1" },
      { code: "UMEDA", name: "梅田店", phone: "06-2345-6789", address: "大阪府大阪市北区梅田2-2-2" },
      { code: "SAKAE", name: "栄店", phone: "052-345-6789", address: "愛知県名古屋市中区栄3-3-3" },
    ].map((data) => prisma.store.create({ data })),
  );

  const staffSpecs = [
    { code: "S001", name: "森田 彩香", role: "MANAGER", storeIdx: 0 },
    { code: "S002", name: "岡田 里奈", role: "STAFF", storeIdx: 0 },
    { code: "S003", name: "藤井 悠", role: "STAFF", storeIdx: 0 },
    { code: "S004", name: "西村 千尋", role: "MANAGER", storeIdx: 1 },
    { code: "S005", name: "大野 香織", role: "STAFF", storeIdx: 1 },
    { code: "S006", name: "宮本 直樹", role: "MANAGER", storeIdx: 2 },
    { code: "S007", name: "堀内 沙耶", role: "STAFF", storeIdx: 2 },
  ];
  const staff = await Promise.all(
    staffSpecs.map((spec) =>
      prisma.staff.create({
        data: { code: spec.code, name: spec.name, role: spec.role, storeId: stores[spec.storeIdx].id },
      }),
    ),
  );

  console.log("ブランド・カテゴリ・シーズンを作成中...");
  const brand = await prisma.brand.create({ data: { code: "WEAR", name: "wear label" } });

  const categorySpecs = [
    { code: "OUTER", name: "アウター" },
    { code: "SHIRT", name: "シャツ・ブラウス" },
    { code: "KNIT", name: "ニット・カーディガン" },
    { code: "CUTSEW", name: "カットソー・Tシャツ" },
    { code: "ONEPIECE", name: "ワンピース" },
    { code: "PANTS", name: "パンツ" },
    { code: "SKIRT", name: "スカート" },
    { code: "BAG", name: "バッグ" },
    { code: "ACC", name: "アクセサリー・小物" },
  ];
  const categories = await Promise.all(
    categorySpecs.map((data) => prisma.category.create({ data })),
  );
  const categoryByCode = new Map(categories.map((c) => [c.code, c]));

  const today = new Date();
  const seasonSpecs = [
    {
      code: "2026SS",
      name: "2026年 春夏",
      year: 2026,
      term: "SS",
      startsOn: new Date(2026, 1, 1),
      endsOn: new Date(2026, 7, 31),
      // 今季はまだプロパー期間 (セール開始日は先)
      saleStartsOn: new Date(2026, 6, 1),
    },
    {
      code: "2025AW",
      name: "2025年 秋冬",
      year: 2025,
      term: "AW",
      startsOn: new Date(2025, 7, 1),
      endsOn: new Date(2026, 2, 31),
      saleStartsOn: new Date(2025, 11, 26),
    },
    {
      code: "2026ALL",
      name: "2026年 通年定番",
      year: 2026,
      term: "ALL",
      startsOn: new Date(2026, 0, 1),
      endsOn: new Date(2026, 11, 31),
      saleStartsOn: null,
    },
  ];
  const seasons = await Promise.all(seasonSpecs.map((data) => prisma.season.create({ data })));
  const seasonByCode = new Map(seasons.map((s) => [s.code, s]));

  console.log("商品と SKU (カラー×サイズ) を作成中...");
  const allVariants: { id: string; sku: string; price: number; listPrice: number }[] = [];

  for (const spec of PRODUCTS) {
    const season = seasonByCode.get(spec.seasonCode);
    const category = categoryByCode.get(spec.categoryCode);
    if (!season || !category) throw new Error(`マスタ未定義: ${spec.styleCode}`);

    const currentPrice = spec.currentPrice ?? spec.listPrice;

    const product = await prisma.product.create({
      data: {
        styleCode: spec.styleCode,
        name: spec.name,
        brandId: brand.id,
        categoryId: category.id,
        seasonId: season.id,
        listPrice: spec.listPrice,
        currentPrice,
        costPrice: spec.cost,
        material: spec.material,
        originCountry: pick(["日本", "中国", "ベトナム", "ポルトガル"]),
        careNote: "洗濯表示に従ってお取り扱いください。",
        status: "ACTIVE",
      },
    });

    // 値下げしている商品は価格改定履歴を残す
    if (currentPrice < spec.listPrice) {
      await prisma.priceChange.create({
        data: {
          productId: product.id,
          fromPrice: spec.listPrice,
          toPrice: currentPrice,
          reason: "MARKDOWN",
          note: `${season.code} シーズンセール`,
          changedBy: "S001",
          changedAt: season.saleStartsOn ?? new Date(),
        },
      });
    }

    for (const colorCode of spec.colors) {
      const color = COLORS.find((c) => c.code === colorCode);
      if (!color) continue;

      for (const sizeCode of spec.sizes) {
        const variant = await prisma.productVariant.create({
          data: {
            productId: product.id,
            sku: buildSku(spec.styleCode, colorCode, sizeCode),
            colorCode: color.code,
            colorName: color.name,
            colorHex: color.hex,
            sizeCode,
            sizeName: sizeCode === "F" ? "FREE" : sizeCode,
            sizeOrder: sizeOrderOf(sizeCode),
            barcode: `49${String(randInt(10_000_000, 99_999_999))}${randInt(0, 9)}`,
          },
        });
        allVariants.push({
          id: variant.id,
          sku: variant.sku,
          price: currentPrice,
          listPrice: spec.listPrice,
        });

        // 店舗ごとに初期在庫を投入 (入荷として履歴も残す)
        for (const store of stores) {
          // 定番サイズ(M/L)は厚めに、端サイズは薄めに
          const base = ["M", "L", "F"].includes(sizeCode) ? randInt(6, 18) : randInt(0, 8);
          if (base === 0) continue;

          await prisma.inventory.create({
            data: {
              storeId: store.id,
              variantId: variant.id,
              quantity: base,
              safetyStock: ["M", "L", "F"].includes(sizeCode) ? 3 : 1,
            },
          });
          await prisma.stockMovement.create({
            data: {
              storeId: store.id,
              variantId: variant.id,
              type: "INBOUND",
              quantity: base,
              balance: base,
              reason: "初回入荷",
              createdAt: new Date(today.getTime() - randInt(60, 150) * 86_400_000),
            },
          });
        }
      }
    }
  }
  console.log(`  -> ${PRODUCTS.length} 品番 / ${allVariants.length} SKU`);

  console.log("顧客を作成中...");
  const customers = await Promise.all(
    CUSTOMER_NAMES.map((entry, i) => {
      const [lastName, firstName, lastNameKana, firstNameKana, gender] = entry;
      const tags = Array.from({ length: randInt(1, 3) }, () => pick(TAG_POOL));
      return prisma.customer.create({
        data: {
          memberCode: `M${String(10001 + i)}`,
          lastName,
          firstName,
          lastNameKana,
          firstNameKana,
          gender,
          phone: `090-${String(randInt(1000, 9999))}-${String(randInt(1000, 9999))}`,
          email: `customer${i + 1}@example.com`,
          birthday: new Date(randInt(1975, 2005), randInt(0, 11), randInt(1, 28)),
          postalCode: `1${String(randInt(50, 99))}-00${randInt(10, 99)}`,
          address: pick(["東京都渋谷区", "東京都世田谷区", "大阪府大阪市北区", "愛知県名古屋市中区"]),
          storeId: pick(stores).id,
          tags: Array.from(new Set(tags)).join(","),
          note: rand() > 0.6 ? pick([
            "普段はМサイズ着用。ゆったりめを好まれる。",
            "通勤用のきれいめを探されることが多い。",
            "セール時期にまとめ買いされる傾向。",
            "ご主人へのギフト購入あり。",
          ]) : null,
        },
      });
    }),
  );

  console.log("LINE 連携を作成中...");
  // 6割の顧客が LINE 連携済みという想定
  const linkedCustomers = customers.filter(() => rand() < 0.6);
  for (const customer of linkedCustomers) {
    await prisma.lineAccount.create({
      data: {
        customerId: customer.id,
        lineUserId: `U${String(randInt(10 ** 9, 10 ** 10 - 1))}${randInt(1000, 9999)}`,
        displayName: `${customer.lastName}${pick(["", "🌸", "@お買い物垢", "ᐡ"])}`,
        isFollowing: rand() > 0.08, // 一部はブロック済み
        linkedAt: new Date(today.getTime() - randInt(10, 300) * 86_400_000),
      },
    });
  }
  console.log(`  -> ${linkedCustomers.length} / ${customers.length} 名が連携済み`);

  console.log("過去180日分の取引を作成中...");
  const paymentMethods = ["CASH", "CREDIT", "CREDIT", "E_MONEY", "QR"];
  let receiptSeq = 1;
  let saleCount = 0;

  for (let dayOffset = 180; dayOffset >= 0; dayOffset -= 1) {
    const date = new Date(today.getTime() - dayOffset * 86_400_000);
    const dow = date.getDay();
    // 週末は客数が増える。直近ほど微増するトレンドを与える
    const weekendBoost = dow === 0 || dow === 6 ? 1.7 : 1;
    const trendBoost = 1 + (180 - dayOffset) / 900;
    const transactions = Math.round(randInt(3, 8) * weekendBoost * trendBoost);

    for (let t = 0; t < transactions; t += 1) {
      const store = pick(stores);
      const storeStaff = staff.filter((s) => s.storeId === store.id);
      const seller = pick(storeStaff);
      // 7割の取引が会員
      const customer = rand() < 0.7 ? pick(customers) : null;

      const soldAt = new Date(date);
      soldAt.setHours(randInt(11, 20), randInt(0, 59), 0, 0);

      const lineCount = randInt(1, 3);
      const chosen = new Map<string, { quantity: number; price: number; listPrice: number }>();
      for (let l = 0; l < lineCount; l += 1) {
        const variant = pick(allVariants);
        const existing = chosen.get(variant.id);
        const quantity = randInt(1, 2);
        chosen.set(variant.id, {
          quantity: (existing?.quantity ?? 0) + quantity,
          price: variant.price,
          listPrice: variant.listPrice,
        });
      }

      const lines = Array.from(chosen.entries()).map(([variantId, item]) => ({
        variantId,
        quantity: item.quantity,
        unitPrice: item.price,
        discount: 0,
        lineTotal: item.price * item.quantity,
        listPriceAtSale: item.listPrice,
      }));

      const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
      // 1割の取引でスタッフ裁量値引き
      const discount = rand() < 0.1 ? Math.round(subtotal * 0.05) : 0;
      const taxable = subtotal - discount;
      const tax = Math.round(taxable * 0.1);
      const total = taxable + tax;

      const rank = customer ? rankForSpent(customer.totalSpent) : "REGULAR";
      const pointsUsed = customer && rand() < 0.12 ? Math.min(customer.points, randInt(100, 500)) : 0;
      const pointsEarned = customer ? calcEarnedPoints(Math.max(0, total - pointsUsed), rank) : 0;

      const sale = await prisma.sale.create({
        data: {
          receiptNo: `${store.code}-${String(receiptSeq).padStart(6, "0")}`,
          externalId: `POS-${store.code}-${String(receiptSeq).padStart(6, "0")}`,
          source: "POS",
          storeId: store.id,
          staffId: seller?.id,
          customerId: customer?.id,
          soldAt,
          subtotal,
          discount,
          tax,
          total,
          pointsUsed,
          pointsEarned,
          paymentMethod: pick(paymentMethods),
          type: "SALE",
          lines: { create: lines },
        },
      });
      receiptSeq += 1;
      saleCount += 1;

      // 在庫を減らす (在庫が無ければスキップして履歴の整合を保つ)
      for (const line of lines) {
        const inv = await prisma.inventory.findUnique({
          where: { storeId_variantId: { storeId: store.id, variantId: line.variantId } },
        });
        if (!inv) continue;
        const balance = inv.quantity - line.quantity;
        await prisma.inventory.update({ where: { id: inv.id }, data: { quantity: Math.max(0, balance) } });
        await prisma.stockMovement.create({
          data: {
            storeId: store.id,
            variantId: line.variantId,
            type: "SALE",
            quantity: -line.quantity,
            balance: Math.max(0, balance),
            refType: "SALE",
            refId: sale.id,
            staffId: seller?.id,
            createdAt: soldAt,
          },
        });
      }

      if (!customer) continue;

      // 顧客の累計・ポイントを更新
      let balance = customer.points;
      if (pointsUsed > 0) {
        balance -= pointsUsed;
        await prisma.pointEvent.create({
          data: {
            customerId: customer.id,
            type: "REDEEM",
            points: -pointsUsed,
            balance,
            saleId: sale.id,
            createdAt: soldAt,
          },
        });
      }
      if (pointsEarned > 0) {
        balance += pointsEarned;
        await prisma.pointEvent.create({
          data: {
            customerId: customer.id,
            type: "EARN",
            points: pointsEarned,
            balance,
            saleId: sale.id,
            createdAt: soldAt,
          },
        });
      }

      customer.points = balance;
      customer.totalSpent += total;
      customer.visitCount += 1;
      customer.firstVisitAt = customer.firstVisitAt ?? soldAt;
      customer.lastVisitAt = soldAt;
      customer.rank = rankForSpent(customer.totalSpent);
    }
  }

  // 集計した顧客実績をまとめて反映
  for (const customer of customers) {
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        points: customer.points,
        totalSpent: customer.totalSpent,
        visitCount: customer.visitCount,
        rank: customer.rank,
        firstVisitAt: customer.firstVisitAt,
        lastVisitAt: customer.lastVisitAt,
      },
    });
  }
  console.log(`  -> ${saleCount} 件の取引`);

  console.log("\n完了しました。");
  console.log(`  店舗: ${stores.length} / スタッフ: ${staff.length}`);
  console.log(`  品番: ${PRODUCTS.length} / SKU: ${allVariants.length}`);
  console.log(`  顧客: ${customers.length} (LINE連携 ${linkedCustomers.length})`);
  console.log(`  取引: ${saleCount}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
