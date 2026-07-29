# wearPOS

アパレル向けの **顧客管理 (CRM) / 在庫管理 / 売上分析** アプリです。
既存の POS レジとは連携 API で接続し、レジで発生した取引を取り込んで在庫・顧客実績・ポイント・LINE 通知まで自動で反映します。

カラー × サイズの SKU 管理と、シーズン (2026SS など) を軸にした値下げ・消化率の把握を中心に据えています。

## 機能

### 商品 / SKU 管理
- 品番 (スタイル) の配下にカラー × サイズのバリエーションを SKU として保持
- カラー × サイズの在庫マトリクス表示（上段: 在庫 / 下段: 累計販売）
- シーズンごとのプロパー / セール判定、値下げ率と価格改定履歴
- 消化率・プロパー消化率・粗利率の算出

### 在庫管理
- 店舗 × SKU 単位の在庫と発注点（安全在庫）
- 入荷 / 在庫調整 / 棚卸の登録。棚卸は実棚数で上書き、それ以外は差分で増減
- すべての在庫変動を `StockMovement` に履歴として記録（変動後残数のスナップショット付き）
- 安全在庫割れのアラート

### 顧客管理 (CRM)
- 会員番号・氏名カナ・連絡先・担当店舗・好みタグ・接客メモ
- 累計購入額に応じた会員ランク（レギュラー / シルバー / ゴールド / プラチナ）とポイント付与率の自動判定
- ポイントの付与・利用・手動調整と、その残高履歴
- 購買履歴から **よく買うサイズ / カラー** を自動集計
- 休眠顧客（90日以上未来店）の抽出

### LINE 公式アカウント連携
- 店頭で6桁の連携コードを発行 → お客様がトークに送信 → 会員情報と LINE アカウントを紐付け
- 購入時にお買い上げ金額・獲得ポイント・残高を自動でプッシュ通知
- 「ポイント」「履歴」などのキーワードに自動応答
- 顧客詳細から個別メッセージを送信、送受信ログを保存
- 友だち追加 / ブロック (unfollow) の状態を追跡

### 売上分析ダッシュボード
- 期間切替（7 / 30 / 90日）と前同期間比較
- 純売上・客数・客単価・プロパー消化率・会員売上比
- 日別の売上と客数の推移
- カラー別 / サイズ別の販売構成、シーズン別売上、売れ筋 SKU、店舗別・スタッフ別実績

## セットアップ

```bash
npm install
cp .env.example .env     # 必要に応じて値を編集
docker compose up -d     # ローカル用の PostgreSQL を起動
npm run db:migrate       # マイグレーションを適用
npm run db:seed          # デモデータ (3店舗 / 140SKU / 180日分の取引) を投入
npm run dev              # http://localhost:3000
```

デモデータを入れ直すだけなら `npm run db:seed` を再実行します（全件削除して作り直します）。
スキーマごと作り直す場合は `npm run db:reset`（**データベースの中身を完全に削除します。本番では実行しないでください**）。

## Vercel + Neon へのデプロイ

アプリを実際に動かす（動的配信）場合は、**[DEPLOY.md](./DEPLOY.md) に詳しい手順**があります。
Neon でのデータベース作成、Vercel へのインポート、環境変数、デモデータ投入、LINE 連携の設定、
トラブルシューティングまでを順に説明しています。

概要だけ示すと次のとおりです。

1. [Neon](https://neon.tech) で PostgreSQL を作り、**Pooled**（`-pooler` 入り）と **Direct** の
   接続文字列を控える
2. [Vercel](https://vercel.com) にリポジトリを Import し、環境変数を設定してからデプロイ
3. 手元から本番 DB に対して `DATABASE_URL="<Direct 接続文字列>" npm run db:seed`

`vercel-build` スクリプトが `prisma migrate deploy` を実行するため、テーブル作成は自動です。

### 注意: 画面に認証がありません

POS 連携 API は API キー、LINE Webhook は署名で保護していますが、**画面側には認証がありません**。
URL を知っていれば誰でも顧客の氏名・電話番号・購買履歴を閲覧できる状態です。
公開する場合はデモデータのみを投入し、実在の顧客データは入れないでください。
実運用にはスタッフログインの追加が必要です。

## GitHub Pages での画面デモ公開

`docs/index.html` に、全画面をデータ入りで確認できる静的デモを生成済みです。
リポジトリの **Settings → Pages** で以下を選ぶと公開されます。

| 項目 | 値 |
| --- | --- |
| Source | Deploy from a branch |
| Branch | `main`（デモを置いたブランチ） |
| Folder | `/docs` |

公開 URL は `https://<ユーザー名>.github.io/wearPOS/` です。

画面やデモデータを変更したあとは、次のコマンドで再生成します。

```bash
npm run db:seed       # デモデータを作り直す場合のみ
npm run demo:build    # ビルド → 各画面を取り込み → docs/index.html を出力
```

`npm run demo:build` はアプリを一時的に起動し、ブラウザで描画された状態の HTML と CSS を
1 枚のページにまとめます。グラフも SVG として保持されるため、画像ではなく実際の描画が残ります。

**デモの制約**: GitHub Pages は静的ファイルのみを配信するため、サーバー処理は動きません。
画面デザインとデータ表示は本物ですが、絞り込み・在庫登録・LINE 送信・POS 連携 API は動作しません
（画面間のリンクとタブ切り替えのみ有効です）。実際に操作する場合は `npm run dev` で起動してください。

### 環境変数

| 変数 | 用途 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL の接続文字列。Neon ではプール付き (`-pooler`) を指定 |
| `DIRECT_DATABASE_URL` | マイグレーション用の直結の接続文字列（Neon などプールを使う場合に必要）|
| `DATABASE_POOL_MAX` | 1インスタンスあたりの最大接続数（省略時 5）|
| `POS_API_KEY` | POS 連携 API の共有シークレット。未設定だと API は 503 を返します |
| `LINE_CHANNEL_SECRET` | LINE Webhook の署名検証に使用 |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE へのメッセージ送信に使用 |
| `LINE_PUSH_ENABLED` | `false` で LINE への送信を停止（送信ログのみ記録）|

LINE の認証情報が未設定でもアプリは動作します。その場合、送信はスキップされログだけが残るため、
連携前の画面確認や開発中の動作確認に使えます。

## POS レジ連携 API

すべてのエンドポイントで `X-API-Key: <POS_API_KEY>` ヘッダ（または `Authorization: Bearer`）が必要です。

### 取引の取り込み

```
POST /api/pos/sales
```

```json
{
  "externalId": "POS-SHIBUYA-000123",
  "storeCode": "SHIBUYA",
  "staffCode": "S002",
  "memberCode": "M10001",
  "soldAt": "2026-07-29T14:32:00+09:00",
  "type": "SALE",
  "paymentMethod": "CREDIT",
  "pointsUsed": 1000,
  "lines": [
    { "sku": "26SS-SH-001-BLK-M", "quantity": 2, "unitPrice": 12800 },
    { "barcode": "4912345678", "quantity": 1, "unitPrice": 12800, "discount": 800 }
  ]
}
```

1リクエストで行われる処理:

1. 伝票と明細を作成
2. 該当店舗の在庫を減算し、在庫変動履歴を記録（`type: "RETURN"` なら加算）
3. 顧客の累計購入額・来店回数・会員ランクを更新
4. ポイントを利用分だけ減算し、正味支払額に対して付与
5. LINE 連携済みならお買い上げ通知をプッシュ

1〜4 は単一トランザクションで実行されます。LINE 送信は外部 API 呼び出しのためトランザクション外で行い、
送信失敗が取引の記録に影響しないようにしています。

**冪等性**: `externalId` が既に存在する場合は何も行わず `duplicated: true` を返します。
通信エラーやタイムアウト時は、同じペイロードをそのまま再送して構いません。

複数取引をまとめて送る場合は `{ "sales": [ ... ] }` 形式（1回あたり最大200件）。
一部が失敗しても成功分は取り込まれ、`errors` に失敗した要素の添字と理由が返ります。

### 照会系

```
GET  /api/pos/products?season=2026SS&updatedSince=2026-07-01T00:00:00Z
GET  /api/pos/inventory?storeCode=SHIBUYA&sku=26SS-SH-001-BLK-M
GET  /api/pos/customers?memberCode=M10001
POST /api/pos/customers        # レジでの新規会員登録
```

`/api/pos/inventory` は `storeCode` を省略すると全店舗の在庫を返すため、他店在庫の取り寄せ判断に使えます。

## LINE Webhook

LINE Developers コンソールに以下を登録します。

```
POST /api/line/webhook
```

`X-Line-Signature` を生のリクエストボディに対して検証し、不一致なら 401 で拒否します。
個々のイベント処理が失敗しても LINE 側の再送を招かないよう、全体としては 200 を返します。

## 技術構成

- **Next.js 15** (App Router / Server Components / Server Actions)
- **Prisma 7** + PostgreSQL（`prisma.config.ts` + pg ドライバアダプタ構成）
- **Tailwind CSS v4**
- **Recharts** — ダッシュボードのグラフ
- **Zod** — API とフォームの入力検証

データベース接続はモジュール読み込み時ではなく初回利用時に作られるため、
`DATABASE_URL` が無い環境でも `next build` は通ります。

## ディレクトリ構成

```
app/
  page.tsx                売上ダッシュボード
  products/               商品一覧・詳細 (SKUマトリクス)
  inventory/              在庫一覧・入出庫・棚卸
  customers/              顧客一覧・詳細 (購買傾向 / ポイント / LINE)
  sales/                  取引履歴・伝票詳細
  settings/               マスタ確認・連携設定
  api/pos/                POSレジ連携 API
  api/line/webhook/       LINE Messaging API Webhook
lib/
  apparel.ts              業種固有のルール (SKU / シーズン / 会員ランク / 消化率)
  sales.ts                POS取引の取り込み
  inventory.ts            在庫増減と履歴記録
  line.ts                 LINE 署名検証・連携・メッセージ送信
  analytics.ts            売上分析クエリ
prisma/
  schema.prisma           データモデル
  migrations/             マイグレーション
  seed.ts                 デモデータ生成
DEPLOY.md                 Vercel + Neon へのデプロイ手順
scripts/
  build-demo.mjs          GitHub Pages 用の静的デモを生成
docs/                     生成された静的デモ (GitHub Pages の公開元)
```

## 補足

- 会計（レジ）画面はこのアプリには含まれません。会計は既存 POS が担い、本アプリはその取引を受け取る側です。
- ポイントは「ポイント利用分を差し引いた正味の支払額」に対して付与され、二重取りを防いでいます。
- 消費税は品番ごとの税率を明細金額で加重平均して算出しています（軽減税率の混在に対応）。
