# 本番サーバーへの移行手順（wearpos.ai-labo.cloud / AWS EC2 自己ホスト）

御社から提供された本番環境（AWS EC2 t3.small・Ubuntu・nginx は御社管理・sudo なし）へ
wearPOS を移し、稼働させるまでの手順です。開発環境（Vercel + Neon）向けの手順は [DEPLOY.md](DEPLOY.md) を参照。

## 全体像

| 役割 | 本番 | 備考 |
| --- | --- | --- |
| 公開 URL | `https://wearpos.ai-labo.cloud` | nginx（御社管理）が受けて **:8026** へ転送 |
| アプリの実行 | PM2（ユーザー権限） | `ecosystem.config.cjs`。ポート 8026 / 0.0.0.0 で待ち受け |
| データベース | 同一サーバーの PostgreSQL 18 | DB名 `wearpos`、ユーザー `ai_labo_dbuser` |
| 定期実行（LINE リマインド） | ユーザーの crontab | Vercel Cron の代わり |
| バックアップ | 御社の自動ダンプ + AWS Backup | アプリ側で独自の cron は組まない（御社案内どおり） |
| ソース | GitHub `main` | `scripts/deploy.sh` で取り込み・ビルド・入れ替え |

**sudo は一切使いません。** すべてホームディレクトリ（`/home/prod4`）内で完結します。

---

## 最短ルート: 1 コマンドで初回セットアップ

Step 1〜6 をまとめて行うスクリプトを用意しています。手元の PC からサーバーに入り、次を実行するだけです。

```bash
# 手元の PC
chmod 600 id_rsa_3piece4-prod.pem
ssh -i id_rsa_3piece4-prod.pem 3piece_prod4@<サーバーIP>

# サーバー上
bash <(curl -fsSL https://raw.githubusercontent.com/emcyrup/wearPOS/main/scripts/bootstrap-onprem.sh)
```

スクリプトは **何度実行しても安全**（済んでいる手順は飛ばす）で、途中で止まるのは次の 2 回だけです。
それぞれ対応してから、**同じコマンドをもう一度**実行すれば続きから進みます。

| 止まる場所 | 画面に出るもの | やること |
| --- | --- | --- |
| ① GitHub 接続 | 公開鍵（`ssh-ed25519 AAAA...`） | GitHub リポジトリ → Settings → Deploy keys に登録（Allow write access は不要） |
| ② `.env` 作成 | `nano ~/wearPOS/.env` の案内 | `DATABASE_URL`（パスワードは [Step 3](#step-3-env-を作る) の表で URL エンコード）と LINE / AI のキーを入力。`AUTH_SECRET` などの乱数は自動生成済み |

`.env` が埋まった状態で 3 回目を実行すると、DB 接続確認 → マイグレーション → ビルド → PM2 起動 → crontab 登録 → ヘルスチェックまで進み、
`✅ セットアップ完了` が出ます。あとは [Step 7](#step-7-外部連携の-url-を切り替える)（LINE の URL 切替）と [Step 8](#step-8-初期設定管理画面)（管理者作成）に進んでください。

> スクリプトが途中で `✗` で止まった場合は、表示されたメッセージと [困ったとき](#困ったとき) を参照。
> 手順を 1 つずつ確認したい場合は、以下の Step 1〜6 を手で実行しても同じ結果になります。

---

## Step 0. 移行前に決めておくこと

### データをどうするか（2択）

| 方針 | 向いている場合 | やること |
| --- | --- | --- |
| **A. まっさらで始める（推奨）** | 開発環境にはテストデータしか無い | 空の DB にマイグレーションだけ流し、初回アクセスの初期セットアップ画面で管理者を作る。商品は CSV 一括取込で入れる |
| **B. 開発環境のデータを持ち込む** | 開発環境で既に実データ（顧客・商品）を運用している | Neon から `pg_dump` → 本番へ `psql` で流し込む（Step 4-B） |

迷ったら **A** です。テストデータ混じりで本番を始めると、あとで「データの初期化」が必要になります。

### 用意する値（あとで `.env` に入れる）

```bash
openssl rand -base64 32   # AUTH_SECRET 用
openssl rand -base64 32   # CRON_SECRET 用
openssl rand -base64 32   # POS_API_KEY 用（外部 POS を使わなくても入れておく）
```

LINE 関連（`LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` / `LIFF_ID` / `LIFF_CHANNEL_ID`）と
AI 関連（`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`）は、開発環境の Vercel に入っている値をそのまま使います。

---

## Step 1. サーバーに入る

```bash
chmod 600 id_rsa_3piece4-prod.pem
ssh -i id_rsa_3piece4-prod.pem 3piece_prod4@<サーバーIP>
```

入ったら前提を確認します。

```bash
node -v          # v22.x であること
psql --version   # 18.x であること
git --version
pm2 -v || echo "pm2 はホーム内に入れます (Step 2)"
date             # タイムゾーン (cron の時刻に使う)
```

---

## Step 2. GitHub から取得して依存を入れる

GitHub への SSH 鍵は、御社案内どおり**ホームディレクトリ内で**作ります。

```bash
ssh-keygen -t ed25519 -C "prod4@wearpos" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub   # → GitHub リポジトリ Settings → Deploy keys に登録 (読み取りのみで可)

cd ~
git clone git@github.com:emcyrup/wearPOS.git
cd wearPOS
npm ci --no-audit --no-fund   # postinstall で prisma generate が走る
```

PM2 は `devDependencies` に入っているため、`npm ci` で一緒に入ります（グローバル導入も sudo も不要）。

```bash
npx --no-install pm2 -v
```

> `--no-install` を必ず付けてください。付けないと、見つからないときに npx が
> 「入れますか?」と聞いて**入力待ちのまま止まります**。

> `npm ci` で `sharp` のビルドに失敗する場合は `npm ci --ignore-scripts` の後に `npx prisma generate` を実行してください。

---

## Step 3. `.env` を作る

```bash
cp .env.production.example .env
nano .env   # または vi
```

### ⚠️ `DATABASE_URL` のパスワードは URL エンコードが必要です

御社発行のパスワードには `! * $ #` が含まれます。そのまま書くと **`#` 以降がコメント扱い**になり、
**`$` が変数展開**されて接続できません。次の置き換えをしてください。

| 文字 | 書き方 |
| --- | --- |
| `!` | `%21` |
| `*` | `%2A` |
| `$` | `%24` |
| `#` | `%23` |
| `@` | `%40` |

さらに、この行は**必ずシングルクォート**で囲みます。

```bash
DATABASE_URL='postgresql://ai_labo_dbuser:<エンコード済みパスワード>@localhost:5432/wearpos'
```

書けたら接続を確かめます（パスワードは画面に出ません）。

```bash
node -e "const u=new URL(process.env.DATABASE_URL);console.log('user:',u.username,'host:',u.hostname,'db:',u.pathname)" \
  --env-file=.env
psql "$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | tr -d "'")" -c 'select version();'
```

`PostgreSQL 18.x` が返れば OK です。`password authentication failed` ならエンコードを見直してください。

### ほかの必須項目

- `AUTH_SECRET` … **未設定だと誰もログインできず、ログイン画面に案内が出ます**（既定値で署名しないため）
- `APP_URL="https://wearpos.ai-labo.cloud"`
- `CRON_SECRET` … Step 6 の cron が使います

---

## Step 4. データベースを用意する

### 4-A. まっさらで始める（推奨）

```bash
npx prisma migrate deploy
```

`All migrations have been successfully applied.` が出れば完了です。
**seed（デモデータ投入）は実行しません。** 管理者アカウントは Step 5 のあと、
初回アクセス時の初期セットアップ画面で作ります。

### 4-B. 開発環境（Neon）のデータを持ち込む

手元の PC で Neon からダンプを取り、サーバーへ送って流し込みます。

```bash
# 手元の PC (Neon の Direct 接続文字列を使う)
pg_dump --no-owner --no-privileges --format=plain \
  "postgresql://neondb_owner:xxxx@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require" \
  > wearpos-dev.sql
scp -i id_rsa_3piece4-prod.pem wearpos-dev.sql 3piece_prod4@<サーバーIP>:~/

# サーバー側
cd ~/wearPOS
psql "$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | tr -d "'")" -f ~/wearpos-dev.sql
npx prisma migrate deploy      # ダンプに含まれない未適用分があれば適用
rm ~/wearpos-dev.sql
```

> ダンプには `_prisma_migrations` テーブルも含まれるため、適用済みの履歴ごと移ります。
> 持ち込んだあと、`admin` / `admin1234` などの**デモアカウントは必ずパスワード変更または削除**してください。

---

## Step 5. ビルドして起動する

```bash
cd ~/wearPOS
mkdir -p logs
NODE_OPTIONS="--max-old-space-size=1536" npx next build   # 2 GiB メモリ向けにヒープ上限を明示
npx --no-install pm2 start ecosystem.config.cjs
npx --no-install pm2 save
npx --no-install pm2 startup   # 表示されたコマンドは sudo が必要なため実行しない (下記参照)
```

> **サーバー再起動後の自動起動について**
> `pm2 startup` が案内するコマンドは sudo が必要なため、この環境では使えません。
> 代わりに **ユーザーの crontab の `@reboot`** で起動します（Step 6 で一緒に登録）。

動作確認:

```bash
curl -s http://127.0.0.1:8026/api/health   # {"instanceAgeMs":...,"dbPingMs":...} が返る
npx --no-install pm2 logs wearpos --lines 50
```

ブラウザで `https://wearpos.ai-labo.cloud/` を開き、ログイン画面（または初期セットアップ画面）が出れば
nginx → アプリの経路は通っています。

---

## Step 6. 定期実行と自動起動（crontab）

```bash
crontab -e
```

次の 2 行を追加します（サーバーが UTC なら 10:00 JST は `0 1`、JST なら `0 10`）。

```cron
# サーバー再起動時にアプリを起動 (sudo 不要の代替)
@reboot cd /home/prod4/wearPOS && /usr/bin/env npx --no-install pm2 resurrect >> /home/prod4/wearPOS/logs/pm2-boot.log 2>&1

# LINE 自動リマインド (Vercel Cron の代わり) 毎日 10:00 JST
0 1 * * * /home/prod4/wearPOS/scripts/reminders-cron.sh >> /home/prod4/wearPOS/logs/reminders.log 2>&1
```

手動で一度動かして確認:

```bash
bash scripts/reminders-cron.sh
```

---

## Step 7. 外部連携の URL を切り替える

ドメインが変わるため、LINE 側の設定を新 URL に向けます（御社案内 7 項の「外部連携の URL 変更」に該当）。

| 場所 | 変更後の値 |
| --- | --- |
| LINE Developers → Messaging API → Webhook URL | `https://wearpos.ai-labo.cloud/api/line/webhook` |
| LINE Developers → LIFF → エンドポイント URL | `https://wearpos.ai-labo.cloud/liff` |
| アプリの 設定 → LINE公式アカウント連携 → リッチメニューを適用 | 再適用してリンク先を更新 |

Webhook URL を入れたら「検証」を押し、成功することを確認します。

---

## Step 8. 初期設定（管理画面）

1. **初期セットアップ**（4-A の場合）: 最初のアクセスで管理者アカウントを作成
2. **設定 → レジ端末のアクセス**: レジ端末コードを決め、店頭の端末で 1 回入力する
   （未設定のあいだはログインした人だけがレジを使えます）
3. **設定 → ログイン画面での新規ユーザー作成**: 既定は「作成させない」。スタッフを迎えるときだけ開く
4. **設定 → ユーザーと権限**: 4-B で持ち込んだ場合、デモアカウントを整理する
5. **設定 → AI考察と個人情報の取り扱い → AI接続テスト**: API キーが本番でも通ることを確認

---

## 日々の更新

GitHub の `main` を更新したら、サーバーで 1 コマンドです。

```bash
cd ~/wearPOS && bash scripts/deploy.sh
```

取得 → `npm ci` → マイグレーション → ビルド → PM2 無停止入れ替え → ヘルスチェックまで行います。
途中で失敗したら古いビルドのまま稼働し続けます（`npx --no-install pm2 logs wearpos` で原因を確認）。

---

## 困ったとき

| 症状 | 確認すること |
| --- | --- |
| ログイン画面に `AUTH_SECRET が設定されていません` と出る | `.env` に `AUTH_SECRET` を入れて `npx --no-install pm2 restart wearpos` |
| `password authentication failed` | `DATABASE_URL` の URL エンコードとシングルクォート（Step 3） |
| ブラウザで開くと 502 | アプリが :8026 で起動しているか `curl http://127.0.0.1:8026/api/health`。落ちていれば `npx --no-install pm2 logs wearpos` |
| 画面は出るがフォーム送信で `Invalid Server Actions request` | nginx が `Host` ヘッダを渡していない。御社に `proxy_set_header Host $host;` の設定を依頼 |
| ログインはできるが LINE から届かない | Webhook URL が旧ドメインのまま（Step 7）。`APP_URL` が新ドメインになっているか |
| `5/5 アプリを入れ替え` から進まない | pm2 が見つからず `npx` が「入れますか?」で入力待ちになっている。Ctrl-C で抜け、`npm install --no-save pm2` のあと `npx --no-install pm2 reload ecosystem.config.cjs --update-env` |
| ビルドが `JavaScript heap out of memory` | `NODE_OPTIONS="--max-old-space-size=1536"` が付いているか。ほかのプロセスがメモリを使っていないか `free -m` |
| サーバー再起動後にアプリが上がらない | crontab の `@reboot` 行（Step 6）と `npx --no-install pm2 save` を実行済みか |

### nginx（御社管理）に必要な設定

アプリ側からは触れないため、以下が入っているかを御社に確認してください。

```nginx
location / {
    proxy_pass         http://127.0.0.1:8026;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;          # ← Server Actions の Origin 検証に必須
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   Upgrade           $http_upgrade;  # 開発時の HMR 用 (本番では無くても可)
    proxy_set_header   Connection        "upgrade";
    proxy_read_timeout 300s;                             # AI考察と CSV 取込は数十秒かかることがある
    client_max_body_size 10m;                            # CSV アップロード
}
```
