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

> ### ⚠️ 先に: コードがあるブランチを確認する
>
> Vercel も `git clone` も、既定では**デフォルトブランチ**を見ます。
> アプリのコードがまだ `main` にマージされていない場合、
> **README.md しか無いブランチをデプロイしようとして失敗します**
> （`package.json` が見つからない、というエラーになります）。
>
> ```bash
> # デフォルトブランチに package.json があるか確認する
> git ls-remote --heads origin
> ```
>
> マージされていない場合は、次のどちらかを先に行ってください。
>
> - **推奨**: 作業ブランチを `main` にマージする（プルリクエストを作成してマージ）
> - または Vercel の **Settings → Git → Production Branch** で作業ブランチを指定する

1. [vercel.com](https://vercel.com) にサインアップします（GitHub アカウント推奨）。
2. **Add New… → Project** から、このリポジトリを **Import** します。
   - 初回は GitHub との連携許可を求められます。リポジトリへのアクセスを許可してください。
3. **Configure Project** の画面が出ます。
   - **Framework Preset**: `Next.js` が自動検出されます。**変更不要**です。
     ここで `Other` と表示される場合は、デフォルトブランチにコードが無い可能性が高いです
     （上の確認に戻ってください）。`Other` のままデプロイすると、静的サイトとして扱われ
     `No Output Directory named "public" found` で失敗します。
     一度 `Other` で作成したプロジェクトは、後からコードを追加しても自動では直りません。
     **Settings → Build and Deployment → Framework Settings** で手動で `Next.js` に変更してください。
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
| `ANTHROPIC_API_KEY` | [Anthropic Console](https://console.anthropic.com/) で発行した API キー。ダッシュボードの AI考察 (壁打ち) に使用 | AI考察を使う場合 |
| `AUTH_SECRET` | ログインセッションの署名鍵。`openssl rand -base64 32` で生成した値 | 推奨 |
| `CRON_SECRET` | LINE 自動リマインド (毎日 10:00 JST の Vercel Cron) の認証キー。ランダム値を設定 | リマインドを使う場合 |

> **ログインについて**: デプロイ後の初回アクセスはログイン画面になります。
> シード (`npm run db:seed`) を実行済みなら `admin` / `admin1234` でログインできます
> （ログイン後に設定 → ユーザーと権限でパスワードを変更してください）。
> シードを使わない場合は、ユーザーが1人もいない状態で表示される初期セットアップ画面から
> 管理者アカウントを作成します。
| `DATABASE_POOL_MAX` | 1インスタンスあたりの最大接続数（既定 5） | 任意 |
| `DATABASE_IDLE_TIMEOUT_MS` | 接続を保持する時間（既定 120000ms）。短くすると再接続が増え遅くなる | 任意 |

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
cd wearPOS          # ← このディレクトリ移動を忘れると package.json が見つかりません

# postinstall で Prisma クライアントが自動生成されます
npm install

# テーブルを作成する。Vercel のデプロイ時にも実行されるため、
# 済んでいれば "No pending migrations" と出るだけで、何度実行しても安全です
DATABASE_URL="<Neon の Direct 接続文字列>" npm run db:deploy

# デモデータを投入する
DATABASE_URL="<Neon の Direct 接続文字列>" npm run db:seed
```

うまくいかない場合は `ls package.json` でファイルの存在を確認してください。
表示されなければ、クローンしたブランチにコードが無いか、`cd wearPOS` を実行できていません。

シードは全データをメモリ上で組み立ててから一括挿入するため、
リモートの DB が相手でも通常 10〜30 秒で終わります。次のように出れば完了です。

```
完了しました。
  店舗: 3 / スタッフ: 7
  品番: 12 / SKU: 140
  顧客: 160 (LINE連携 89)
  取引: 1421 / 明細: 1959 / 客単価: ¥21,718
  在庫変動: 2379 / ポイント履歴: 1100
  ランク分布: { PLATINUM: 8, GOLD: 20, SILVER: 99, REGULAR: 33 }
  所要時間: 5.5 秒
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

### リッチメニューをタップで直接画面遷移にする（推奨・任意）

リッチメニューは LIFF を設定すると、タップした瞬間に会員登録フォーム・会員証・ポイント画面が
開くようになります（未設定の場合はキーワード送信 → 自動返信の方式で動きます）。

1. [LINE Developers](https://developers.line.biz/) の同じプロバイダーに **LINE Login チャネル**を作成します
   （既にあればそれを使用）。
2. チャネル内の **LIFF タブ → 追加** で LIFF アプリを作成します。
   - サイズ: **Full**
   - エンドポイント URL: `https://YOUR_APP.vercel.app/liff`
   - スコープ: **openid** にチェック（profile も推奨）
3. 発行された **LIFF ID** を控えます → 環境変数 `LIFF_ID`
4. LINE Login チャネルの **チャネル基本設定** にある **チャネル ID** を控えます → `LIFF_CHANNEL_ID`
5. Vercel に 2 つの環境変数を登録して **Redeploy** します。
6. アプリの 設定 → LINE公式アカウント連携 → **「リッチメニューを適用」** をもう一度押します。
   結果に「タップで直接画面が開きます」と表示されれば完了です。

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

## 表示が遅いときの切り分け

`/api/health` を開くと、リクエストごとの内訳が JSON で返ります。
**2〜3回続けて開いて**、値の変化を見てください。

```
https://YOUR_APP.vercel.app/api/health
```

| 観測 | 原因 | 対処 |
| --- | --- | --- |
| `instanceAgeMs` が毎回小さい / `requestsServedByThisInstance` が毎回 1 | 実行環境が毎回作り直されている（コールドスタート）| アクセスが疎な環境では避けにくい。定期アクセスで暖めるか、常時起動の構成に変える |
| `dbPingMs` が初回だけ大きく2回目以降は小さい | データベースが停止状態から復帰している（Neon 無料枠の自動停止）| Neon の有料プラン、または定期アクセス |
| `dbPingMs` が常に大きい (100ms超) | アプリとデータベースが離れている、または接続を張り直している | `region` の値と Neon のリージョンを突き合わせる |
| すべて小さいのに画面が遅い | サーバー側ではなく回線か端末側 | ブラウザの開発者ツールで内訳を確認する |

`region` にはアプリが実行されたリージョンが入ります。Neon のリージョンと
離れていないかの確認にも使えます。

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
| シードが止まったように見える | 通常は 10〜30 秒で終わります。それ以上かかる場合は Pooled ではなく **Direct** の接続文字列を使ってください |
| `Could not read package.json` (ENOENT) | クローンしたブランチにコードが無いか、`cd wearPOS` を実行していない。Step 5 のコマンドを参照 |
| `Cannot find module '.prisma/client/default'` | Prisma クライアントが未生成。`npx prisma generate` を実行してから再試行してください |
| `relation "Store" does not exist`（シード時） | テーブルが未作成。先に `npm run db:deploy` を実行してください |
| Vercel のビルドが `No Next.js version detected` で失敗 | デプロイ対象のブランチにコードが無い。Step 2 の確認を参照 |
| `No Output Directory named "public" found` | Framework Preset が `Other` のまま。**Settings → Build and Deployment → Framework Settings** で `Next.js` に変更し、Build Command と Output Directory の Override を解除してから再デプロイ |

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
