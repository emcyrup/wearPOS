import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import "dotenv/config";

import { buildSku, calcEarnedPoints, rankForSpent, sizeOrderOf } from "../lib/apparel";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
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

const SURNAMES: [string, string][] = [
  ["佐藤", "サトウ"], ["鈴木", "スズキ"], ["高橋", "タカハシ"], ["田中", "タナカ"],
  ["伊藤", "イトウ"], ["渡辺", "ワタナベ"], ["山本", "ヤマモト"], ["中村", "ナカムラ"],
  ["小林", "コバヤシ"], ["加藤", "カトウ"], ["吉田", "ヨシダ"], ["山田", "ヤマダ"],
  ["佐々木", "ササキ"], ["松本", "マツモト"], ["井上", "イノウエ"], ["木村", "キムラ"],
  ["林", "ハヤシ"], ["清水", "シミズ"], ["山口", "ヤマグチ"], ["斎藤", "サイトウ"],
  ["池田", "イケダ"], ["橋本", "ハシモト"], ["石川", "イシカワ"], ["前田", "マエダ"],
  ["藤田", "フジタ"], ["後藤", "ゴトウ"], ["岡田", "オカダ"], ["長谷川", "ハセガワ"],
  ["村上", "ムラカミ"], ["近藤", "コンドウ"], ["石井", "イシイ"], ["坂本", "サカモト"],
];

const GIVEN_NAMES: [string, string, string][] = [
  ["美咲", "ミサキ", "FEMALE"], ["陽菜", "ヒナ", "FEMALE"], ["さくら", "サクラ", "FEMALE"],
  ["結衣", "ユイ", "FEMALE"], ["彩", "アヤ", "FEMALE"], ["遥", "ハルカ", "FEMALE"],
  ["愛", "アイ", "FEMALE"], ["真央", "マオ", "FEMALE"], ["杏", "アン", "FEMALE"],
  ["千夏", "チナツ", "FEMALE"], ["美穂", "ミホ", "FEMALE"], ["楓", "カエデ", "FEMALE"],
  ["菜々", "ナナ", "FEMALE"], ["優花", "ユウカ", "FEMALE"], ["咲", "サキ", "FEMALE"],
  ["詩織", "シオリ", "FEMALE"], ["七海", "ナナミ", "FEMALE"], ["莉子", "リコ", "FEMALE"],
  ["葵", "アオイ", "FEMALE"], ["芽衣", "メイ", "FEMALE"], ["理沙", "リサ", "FEMALE"],
  ["健太", "ケンタ", "MALE"], ["翔太", "ショウタ", "MALE"], ["大輔", "ダイスケ", "MALE"],
  ["拓也", "タクヤ", "MALE"], ["涼", "リョウ", "MALE"], ["隼人", "ハヤト", "MALE"],
  ["健", "ケン", "MALE"], ["亮", "リョウ", "MALE"], ["直人", "ナオト", "MALE"],
];

const TAG_POOL = [
  "カジュアル", "モノトーン", "きれいめ", "ナチュラル", "トレンド重視",
  "セール狙い", "新作チェック", "アウター好き", "小物好き", "リネン好み",
];

/**
 * 顧客セグメント。来店回数と来店時期の分布を決める。
 * 実店舗の会員構成に近づけ、ランク・新規・休眠・リピート率が一様にならないようにする。
 */
const SEGMENTS = [
  /** 常連上位。月4〜5回来店する少数の優良顧客 */
  { key: "VIP", ratio: 0.05, visits: [22, 32] as const, windowStart: 175, windowEnd: 0 },
  /** 定期的に来店するリピーター */
  { key: "LOYAL", ratio: 0.14, visits: [8, 16] as const, windowStart: 170, windowEnd: 0 },
  /** 年に数回来店する一般会員 */
  { key: "REGULAR", ratio: 0.33, visits: [3, 7] as const, windowStart: 165, windowEnd: 0 },
  /** 直近45日以内に入会した新規会員 */
  { key: "NEW", ratio: 0.2, visits: [1, 2] as const, windowStart: 45, windowEnd: 0 },
  /** 90日以上来店のない休眠会員。来店は期間前半に偏る */
  { key: "DORMANT", ratio: 0.28, visits: [2, 6] as const, windowStart: 180, windowEnd: 95 },
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
        const isCoreSize = ["M", "L", "F"].includes(sizeCode);
        for (const store of stores) {
          // 定番サイズ(M/L)は厚めに、端サイズは薄めに
          const base = isCoreSize ? randInt(18, 40) : randInt(4, 16);

          await prisma.inventory.create({
            data: {
              storeId: store.id,
              variantId: variant.id,
              quantity: base,
              safetyStock: isCoreSize ? 4 : 2,
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
              createdAt: new Date(today.getTime() - randInt(150, 200) * 86_400_000),
            },
          });
        }
      }
    }
  }
  console.log(`  -> ${PRODUCTS.length} 品番 / ${allVariants.length} SKU`);

  console.log("顧客を作成中...");
  const CUSTOMER_COUNT = 160;

  // セグメント比率に従って各顧客の来店パターンを決める
  const segmentPlan: (typeof SEGMENTS)[number][] = [];
  for (const segment of SEGMENTS) {
    const count = Math.round(CUSTOMER_COUNT * segment.ratio);
    for (let i = 0; i < count; i += 1) segmentPlan.push(segment);
  }
  while (segmentPlan.length < CUSTOMER_COUNT) segmentPlan.push(SEGMENTS[2]);

  const usedNames = new Set<string>();
  const customers = [];

  for (let i = 0; i < CUSTOMER_COUNT; i += 1) {
    // 姓名の組み合わせが重複しないように選び直す
    let surname = pick(SURNAMES);
    let given = pick(GIVEN_NAMES);
    let guard = 0;
    while (usedNames.has(`${surname[0]}${given[0]}`) && guard < 200) {
      surname = pick(SURNAMES);
      given = pick(GIVEN_NAMES);
      guard += 1;
    }
    usedNames.add(`${surname[0]}${given[0]}`);

    const segment = segmentPlan[i];
    const visitCount = randInt(segment.visits[0], segment.visits[1]);

    // 来店日をセグメントの期間内に散らす
    const visitOffsets = Array.from({ length: visitCount }, () =>
      randInt(segment.windowEnd, segment.windowStart),
    ).sort((a, b) => b - a);

    const firstVisitOffset = visitOffsets[0];
    const tags = Array.from({ length: randInt(1, 3) }, () => pick(TAG_POOL));

    const record = await prisma.customer.create({
      data: {
        memberCode: `M${String(10001 + i)}`,
        lastName: surname[0],
        firstName: given[0],
        lastNameKana: surname[1],
        firstNameKana: given[1],
        gender: given[2],
        phone: `090-${String(randInt(1000, 9999))}-${String(randInt(1000, 9999))}`,
        email: `customer${i + 1}@example.com`,
        birthday: new Date(randInt(1975, 2005), randInt(0, 11), randInt(1, 28)),
        postalCode: `1${String(randInt(50, 99))}-00${randInt(10, 99)}`,
        address: pick(["東京都渋谷区", "東京都世田谷区", "大阪府大阪市北区", "愛知県名古屋市中区"]),
        storeId: pick(stores).id,
        tags: Array.from(new Set(tags)).join(","),
        // 入会日は初回来店日に合わせる
        createdAt: new Date(today.getTime() - firstVisitOffset * 86_400_000),
        note:
          rand() > 0.6
            ? pick([
                "普段はMサイズ着用。ゆったりめを好まれる。",
                "通勤用のきれいめを探されることが多い。",
                "セール時期にまとめ買いされる傾向。",
                "ご家族へのギフト購入あり。",
                "同じ品番を色違いで購入されることが多い。",
              ])
            : null,
      },
    });

    customers.push({
      record,
      segment: segment.key,
      visitOffsets,
      // 集計用の可変状態
      points: 0,
      totalSpent: 0,
      visitCount: 0,
      rank: "REGULAR",
      firstVisitAt: null as Date | null,
      lastVisitAt: null as Date | null,
    });
  }

  const segmentCounts = customers.reduce<Record<string, number>>((acc, c) => {
    acc[c.segment] = (acc[c.segment] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`  -> ${customers.length} 名`, segmentCounts);

  console.log("LINE 連携を作成中...");
  // 新規会員ほど連携率が高く、休眠会員は低いという想定
  const linkRate: Record<string, number> = {
    VIP: 0.85,
    LOYAL: 0.75,
    REGULAR: 0.55,
    NEW: 0.7,
    DORMANT: 0.3,
  };
  let linkedCount = 0;
  for (const customer of customers) {
    if (rand() >= (linkRate[customer.segment] ?? 0.5)) continue;
    const firstVisit = customer.visitOffsets[0] ?? 30;
    await prisma.lineAccount.create({
      data: {
        customerId: customer.record.id,
        lineUserId: `U${String(randInt(10 ** 9, 10 ** 10 - 1))}${randInt(1000, 9999)}`,
        displayName: `${customer.record.lastName}${pick(["", "🌸", "@お買い物垢", "ᐡ"])}`,
        // 休眠会員には一定割合でブロック済みを混ぜる
        isFollowing: customer.segment === "DORMANT" ? rand() > 0.25 : rand() > 0.05,
        linkedAt: new Date(today.getTime() - randInt(0, firstVisit) * 86_400_000),
      },
    });
    linkedCount += 1;
  }
  console.log(`  -> ${linkedCount} / ${customers.length} 名が連携済み`);

  console.log("過去180日分の取引を作成中...");
  const paymentMethods = ["CASH", "CREDIT", "CREDIT", "E_MONEY", "QR"];

  type Visit = { dayOffset: number; customer: (typeof customers)[number] | null };
  const visits: Visit[] = [];

  for (const customer of customers) {
    for (const dayOffset of customer.visitOffsets) {
      visits.push({ dayOffset, customer });
    }
  }

  // 非会員(ウォークイン)の取引を全体の約3割になるよう追加する
  const walkInCount = Math.round(visits.length * 0.43);
  for (let i = 0; i < walkInCount; i += 1) {
    let dayOffset = randInt(0, 180);
    const date = new Date(today.getTime() - dayOffset * 86_400_000);
    const dow = date.getDay();
    // 週末に寄せるため、平日に当たったら一定確率で引き直す
    if (dow !== 0 && dow !== 6 && rand() < 0.35) dayOffset = randInt(0, 180);
    visits.push({ dayOffset, customer: null });
  }

  // 古い順に処理して、ポイント残高とランクが時系列で正しく積み上がるようにする
  visits.sort((a, b) => b.dayOffset - a.dayOffset);

  let receiptSeq = 1;
  let saleCount = 0;

  for (const visit of visits) {
    const store = pick(stores);
    const storeStaff = staff.filter((s) => s.storeId === store.id);
    const seller = pick(storeStaff);
    const customer = visit.customer;

    const soldAt = new Date(today.getTime() - visit.dayOffset * 86_400_000);
    soldAt.setHours(randInt(11, 20), randInt(0, 59), 0, 0);

    // 買上点数は1点が中心。まとめ買いは少数
    const roll = rand();
    const lineCount = roll < 0.7 ? 1 : roll < 0.92 ? 2 : 3;

    const chosen = new Map<string, { quantity: number; price: number; listPrice: number }>();
    for (let l = 0; l < lineCount; l += 1) {
      const variant = pick(allVariants);
      const existing = chosen.get(variant.id);
      // 同じ SKU を2点買うのは稀 (色違い・サイズ違いが普通)
      const quantity = existing ? 1 : rand() < 0.12 ? 2 : 1;
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

    const rank = customer ? customer.rank : "REGULAR";
    const pointsUsed =
      customer && customer.points >= 500 && rand() < 0.15
        ? Math.min(customer.points, randInt(300, 1500))
        : 0;
    const pointsEarned = customer ? calcEarnedPoints(Math.max(0, total - pointsUsed), rank) : 0;

    const sale = await prisma.sale.create({
      data: {
        receiptNo: `${store.code}-${String(receiptSeq).padStart(6, "0")}`,
        externalId: `POS-${store.code}-${String(receiptSeq).padStart(6, "0")}`,
        source: "POS",
        storeId: store.id,
        staffId: seller?.id,
        customerId: customer?.record.id,
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
      const balance = Math.max(0, inv.quantity - line.quantity);
      await prisma.inventory.update({ where: { id: inv.id }, data: { quantity: balance } });
      await prisma.stockMovement.create({
        data: {
          storeId: store.id,
          variantId: line.variantId,
          type: "SALE",
          quantity: -line.quantity,
          balance,
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
          customerId: customer.record.id,
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
          customerId: customer.record.id,
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

  // 集計した顧客実績をまとめて反映
  for (const customer of customers) {
    await prisma.customer.update({
      where: { id: customer.record.id },
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

  // 集計サマリを出して、分布が偏っていないか確認できるようにする
  const rankCounts = customers.reduce<Record<string, number>>((acc, c) => {
    acc[c.rank] = (acc[c.rank] ?? 0) + 1;
    return acc;
  }, {});
  const totalSales = await prisma.sale.aggregate({ _sum: { total: true }, _count: { _all: true } });
  const averageOrder = totalSales._count._all
    ? Math.round((totalSales._sum.total ?? 0) / totalSales._count._all)
    : 0;
  const repeaters = customers.filter((c) => c.visitCount > 1).length;
  const dormant = customers.filter(
    (c) => c.lastVisitAt && today.getTime() - c.lastVisitAt.getTime() > 90 * 86_400_000,
  ).length;
  const newcomers = customers.filter(
    (c) => c.firstVisitAt && today.getTime() - c.firstVisitAt.getTime() <= 30 * 86_400_000,
  ).length;

  console.log("\n完了しました。");
  console.log(`  店舗: ${stores.length} / スタッフ: ${staff.length}`);
  console.log(`  品番: ${PRODUCTS.length} / SKU: ${allVariants.length}`);
  console.log(`  顧客: ${customers.length} (LINE連携 ${linkedCount})`);
  console.log(`  取引: ${saleCount} / 客単価: ¥${averageOrder.toLocaleString("ja-JP")}`);
  console.log(`  ランク分布:`, rankCounts);
  console.log(
    `  直近30日の新規: ${newcomers} 名 / リピーター: ${repeaters} 名 / 休眠(90日以上): ${dormant} 名`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
