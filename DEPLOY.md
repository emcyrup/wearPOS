# デプロイ手順（Vercel + Neon）

wearPOS を実際に動く状態でインターネットに公開するまでの手順です。
所要時間はおよそ 30 分、費用は無料枠の範囲で始められます。

## 全体像

| 役割 | サービス | 備考 |
| --- | --- | --- |
| アプリの実行 | Vercel | GitHub に push すると自動でデプロイされる |
| データベース | Neon (PostgreSQL) | サーバーレス対応。接続プールを提供 |
| ソース管理 | GitHub | Vercel と連携する |

Vercel は関数単位でアプリを動かすため、アクセスのたびに新しい実行環境が立ち上がることがあります。
通常の PostgreSQL だと接続数がすぐ上限に達するので、接続プールを持つ Neon を組み合わせます。

> **先に確認してください**
> このアプリの**画面には認証がありません**。URL を知っていれば誰でも顧客の氏名・電話番号・購買履歴を
> 閲覧・編集できます。公開する場合はデモデータのみを投入し、実在する顧客の情報は入れないでください。

---

## Step 1. Neon でデータベースを用意する

1. [neon.tech](https://neon.tech) にサインアップします（GitHub アカウントでログインできます）。
2. **Create project** で新しいプロジェクトを作ります。
   - Project name: `wearpos` など
   - Postgres version: 既定のままで問題ありません
   - Region: **Step 2 で選ぶ Vercel のリージョンに近いもの**を選びます（アジア圏なら Singapore
     `ap-southeast-1` など）。距離が離れるとページ表示のたびに往復の遅延が乗ります。
3. プロジェクト作成後、**Connection string**（Connect / Connection Details といったパネル）を開きます。
4. **2種類の接続文字列を控えます。** 切り替えは「Pooled connection」のチェックボックスなどで行います。

| 用途 | 種類 | 見分け方 |
| --- | --- | --- |
| アプリ用 (`DATABASE_URL`) | **Pooled** | ホスト名に **`-pooler`** が入る |
| マイグレーション用 (`DIRECT_DATABASE_URL`) | **Direct**（プールなし） | `-pooler` が**入らない** |

```
# Pooled（アプリ用）
postgresql://neondb_owner:xxxx@ep-cool-name-123456-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require

# Direct（マイグレーション用）
postgresql://neondb_owner:xxxx@ep-cool-name-123456.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
```

**なぜ2種類必要か**: アプリは接続プール経由で繋ぐことで接続枯渇を防げますが、
プールはテーブル定義の変更のような操作と相性が悪く、マイグレーションが失敗することがあります。
そのためスキーマ変更だけは直結の接続を使います。

---

## Step 2. Vercel にインポートする

1. [vercel.com](https://vercel.com) にサインアップします（GitHub アカウント推奨）。
2. **Add New… → Project** から、このリポジトリを **Import** します。
   - 初回は GitHub との連携許可を求められます。リポジトリへのアクセスを許可してください。
3. **Configure Project** の画面が出ます。
   - **Framework Preset**: `Next.js` が自動検出されます。**変更不要**です。
   - **Build Command / Output Directory / Install Command**: すべて既定のままで構いません。
     `package.json` の `vercel-build` スクリプトが自動的に使われます。
   - **Root Directory**: `./`（既定）
4. ここで**まだ Deploy を押さず**、次の Step 3 で環境変数を入れます。

> **リージョンについて**: 既定では米国東部で動きます。日本から使うなら、デプロイ後に
> **Settings → Functions → Function Region** で東京 (`hnd1`) など近いリージョンに変更してください。
> Neon のリージョンと近いほど、DB との往復が速くなります。

---

## Step 3. 環境変数を設定する

Configure Project 画面の **Environment Variables**（デプロイ後なら Settings → Environment Variables）に
以下を登録します。

| 変数名 | 値 | 必須 |
| --- | --- | --- |
| `DATABASE_URL` | Neon の **Pooled** 接続文字列 | ✅ |
| `DIRECT_DATABASE_URL` | Neon の **Direct** 接続文字列 | ✅ |
| `POS_API_KEY` | 任意の長いランダム文字列 | ✅ |
| `LINE_CHANNEL_SECRET` | LINE 公式アカウントのチャネルシークレット | LINE を使う場合 |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE のチャネルアクセストークン | LINE を使う場合 |
| `LINE_PUSH_ENABLED` | `false` にすると LINE 送信を止めてログだけ残す | 任意 |
| `DATABASE_POOL_MAX` | 1インスタンスあたりの最大接続数（既定 5） | 任意 |

`POS_API_KEY` は手元で生成してください。

```bash
openssl rand -base64 32
```

環境は Production / Preview / Development が選べます。まずは **すべてにチェック**を入れておくと、
プレビュー環境でも同じ DB を見て動作確認できます（本番データを分けたくなったら、後から
Production 用に別の Neon プロジェクトを割り当ててください）。

> **注意**: Vercel は環境変数を変更しても自動では再デプロイされません。
> 変更後は **Deployments → 最新のデプロイ → Redeploy** を実行してください。

---

## Step 4. デプロイする

**Deploy** を押します。ビルドログで次の順に流れれば成功です。

```
Running "vercel-build"
  → prisma generate           Prisma クライアントを生成
  → prisma migrate deploy     テーブルを作成（初回は 1 migration applied）
  → next build                アプリをビルド
```

完了すると `https://<プロジェクト名>.vercel.app` が払い出されます。

この時点で画面は開きますが、**データが空**なので一覧はすべて 0 件です。次で投入します。

---

## Step 5. デモデータを投入する

シードは手元の PC から本番 DB に対して流します（Vercel の関数には実行時間の上限があり、
180日分の取引生成には足りないため）。

```bash
git clone https://github.com/emcyrup/wearPOS.git
cd wearPOS
npm install

DATABASE_URL="<Neon の Direct 接続文字列>" npm run db:seed
```

数分かかります。次のように出れば完了です。

```
完了しました。
  店舗: 3 / スタッフ: 7
  品番: 12 / SKU: 140
  顧客: 160 (LINE連携 88)
  取引: 1356 / 客単価: ¥21,840
```

ブラウザで `https://<プロジェクト名>.vercel.app` を開くと、ダッシュボードにデータが表示されます。

> `npm run db:seed` は**既存データを全件削除してから**作り直します。
> 実データが入っている DB に対しては絶対に実行しないでください。

---

## Step 6. 動作確認

### 画面

| URL | 確認内容 |
| --- | --- |
| `/` | 売上ダッシュボードにグラフと数値が出る |
| `/products` | 12 品番が並ぶ |
| `/customers` | 160 名が並ぶ |
| `/settings` | POS API キーと LINE の設定状況が「設定済み」になっている |

### POS 連携 API

`YOUR_APP` と `YOUR_KEY` を置き換えて実行します。

```bash
# 1) 認証されないことを確認（401 が返れば正常）
curl -i -X POST https://YOUR_APP.vercel.app/api/pos/sales \
  -H 'Content-Type: application/json' -d '{}'

# 2) 在庫照会
curl "https://YOUR_APP.vercel.app/api/pos/inventory?storeCode=SHIBUYA&sku=26SS-SH-001-BLK-M" \
  -H "X-API-Key: YOUR_KEY"

# 3) 取引の取り込み
curl -X POST https://YOUR_APP.vercel.app/api/pos/sales \
  -H "X-API-Key: YOUR_KEY" -H 'Content-Type: application/json' \
  -d '{
    "externalId": "TEST-0001",
    "storeCode": "SHIBUYA",
    "staffCode": "S002",
    "memberCode": "M10001",
    "soldAt": "2026-07-29T14:32:00+09:00",
    "paymentMethod": "CREDIT",
    "lines": [{ "sku": "26SS-SH-001-BLK-M", "quantity": 2, "unitPrice": 12800 }]
  }'

# 4) もう一度 3) を実行して "duplicated": true が返れば冪等性が効いている
# 5) もう一度 2) を実行して在庫が 2 減っていれば取り込み成功
```

`/sales` 画面にも伝票が増えているはずです。

---

## Step 7. LINE 公式アカウントを連携する（任意）

1. [LINE Developers](https://developers.line.biz/) にログインし、**プロバイダー**を作成します。
2. **Messaging API** チャネルを新規作成します。
3. **チャネル基本設定** タブで **チャネルシークレット** を控えます → `LINE_CHANNEL_SECRET`
4. **Messaging API 設定** タブで **チャネルアクセストークン（長期）** を発行して控えます
   → `LINE_CHANNEL_ACCESS_TOKEN`
5. 同じタブの **Webhook URL** に次を設定し、**Webhook の利用**を ON にします。

   ```
   https://YOUR_APP.vercel.app/api/line/webhook
   ```

6. **「検証」ボタン**を押して成功することを確認します。
7. 同じタブの **応答メッセージ** を **オフ**にします。
   オンのままだと LINE 側の自動応答が優先され、アプリからの返信が届きません。
8. Vercel に手順 3・4 の値を環境変数として登録し、**再デプロイ**します。

### 連携の流れ（動作確認）

1. 公式アカウントを友だち追加すると、連携の案内メッセージが届きます。
2. アプリの `/customers` から任意の顧客を開き、**「連携コードを発行」** を押します。
3. 表示された 6 桁のコードを LINE のトークに送信します。
4. 「会員情報の連携が完了しました」と返信が来て、顧客画面が「LINE 連携済」に変わります。
5. その顧客の会員番号で Step 6 の取引取り込みを行うと、お買い上げ通知が LINE に届きます。

---

## 運用

### コードを更新したとき

GitHub の対象ブランチに push すると Vercel が自動でデプロイします。
`vercel-build` が毎回 `prisma migrate deploy` を実行するため、マイグレーションも自動で適用されます。

### スキーマを変更したとき

```bash
# 手元で変更してマイグレーションを作る
npm run db:migrate -- --name add_something

# 生成された prisma/migrations/ をコミットして push
git add prisma/ && git commit -m "..." && git push
```

migration ファイルをコミットし忘れると、本番にテーブル変更が反映されません。

### 前のバージョンに戻したいとき

Vercel の **Deployments** から以前のデプロイを選び、**Promote to Production** を実行します。
ただし**データベースは戻りません**。テーブル定義を変えるマイグレーションを含む場合は、
戻す前に影響を確認してください。

---

## トラブルシューティング

| 症状 | 原因と対処 |
| --- | --- |
| 画面が 500 エラー | `DATABASE_URL` が未設定か誤り。設定後に**再デプロイ**が必要 |
| `relation "Store" does not exist` | マイグレーションが未適用。ビルドログに `migrate deploy` が出ているか確認。出ていなければ Build Command が上書きされていないか確認 |
| ビルド時に `prisma migrate deploy` が失敗 | `DIRECT_DATABASE_URL` に**プールなし**の接続文字列を設定（`-pooler` が入っていない方） |
| `too many connections` | `DATABASE_URL` が Pooled になっているか確認。それでも出るなら `DATABASE_POOL_MAX` を `3` などに下げる |
| 初回アクセスだけ数秒待たされる | Neon の無料枠はアイドル時に自動停止します。有料プランか、定期アクセスで回避できます |
| LINE Webhook の検証が失敗する | `LINE_CHANNEL_SECRET` が誤っているか、環境変数の設定後に再デプロイしていない |
| LINE の返信が定型文になる | LINE 側の**応答メッセージ**がオンのまま。オフにしてください |
| シードが途中で止まる | Pooled ではなく **Direct** の接続文字列で実行してください |

ビルドやアクセス時のエラーは、Vercel の **Deployments → 該当デプロイ → Logs**（実行時は **Runtime Logs**）で確認できます。

---

## 費用の目安

| サービス | 無料枠 | 超えた場合 |
| --- | --- | --- |
| Vercel Hobby | 個人・**非商用**利用 | Pro は $20/月〜 |
| Neon Free | 0.5 GB ストレージ / 自動停止あり | Launch は $19/月〜 |

**Vercel の Hobby プランは商用利用が認められていません。** 実際の店舗業務で使う場合は
Pro プランへの変更が必要です。

---

## 本番運用の前に

このアプリはデモとして完成していますが、実際の顧客データを扱う前に以下が必要です。

- [ ] **スタッフログイン**（現状は認証なしで全画面が公開されます）
- [ ] 操作ログ（誰がいつ在庫やポイントを変更したかの記録）
- [ ] データベースのバックアップ運用（Neon の Point-in-time restore など）
- [ ] `POS_API_KEY` の店舗別発行とローテーション
- [ ] 個人情報の取り扱い方針の整備（保存期間、削除依頼への対応）

認証の追加が必要になったらご相談ください。スタッフマスタは既にあるため、
ログイン画面とセッション管理の追加で対応できます。
