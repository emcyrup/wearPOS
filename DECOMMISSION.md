# 撤去手順（案件終了・サーバー返却）

wearPOS を停止し、関係するサービスを片付けるまでのチェックリストです。
**上から順に**進めてください。順番を変えると、バックアップを取る前にデータが消える恐れがあります。

> ⚠️ **最初にバックアップを取ります。** データベースを消したあとでは元に戻せません。
> 取引履歴・顧客情報は、あとから「あのときの売上は」と聞かれることがあります。
> 保管期間はお店のご方針に合わせてください。

---

## Step 1. データベースのバックアップを取る（最優先）

サーバーに入って実行します。

```bash
ssh -i <鍵ファイル> <接続ユーザー>@<サーバーIP>
cd ~/wearPOS && bash scripts/teardown-onprem.sh
```

バックアップを取ったところでスクリプトが止まります。画面に次の 2 ファイルが出ます。

| ファイル | 中身 |
| --- | --- |
| `~/wearpos-backup-<日時>.dump` | 全データ（復元用。圧縮形式） |
| `~/wearpos-backup-<日時>.schema.sql` | テーブル定義だけ（中身を目で確認する用） |

あわせて、伝票・顧客・商品などの**件数**が表示されます。0 件ばかりでないことを確認してください。

### 手元の PC に持ち出す

```bash
scp -i <鍵ファイル> <接続ユーザー>@<サーバーIP>:~/wearpos-backup-*.dump .
scp -i <鍵ファイル> <接続ユーザー>@<サーバーIP>:~/wearpos-backup-*.schema.sql .
```

> 💡 **バックアップが開けることを確かめておくと安心です。** 手元に PostgreSQL があれば:
> ```bash
> pg_restore --list wearpos-backup-<日時>.dump | head
> ```
> テーブル名がずらりと出れば、中身は入っています。

**持ち出したファイルは、お店の取引履歴と顧客情報そのものです。** 社内の安全な場所
（共有ドライブの限定フォルダ等）に保管し、置き場所を Bitwarden などに記録してください。

---

## Step 2. アプリを停止する

バックアップを持ち出せたら、サーバーで続きを実行します。

```bash
cd ~/wearPOS && bash scripts/teardown-onprem.sh --backup-saved
```

次を行います。

- PM2 のプロセスを停止・削除し、保存済みの一覧も空にする（再起動しても復活しない）
- crontab から wearPOS の 2 行（`@reboot` の自動起動・リマインド配信）を削除
- `:8026` が応答しなくなったことを確認

この時点で `https://wearpos.ai-labo.cloud` は 502 になります。

---

## Step 3. LINE 連携を解除する

アプリが止まると、お客様が LINE で話しかけても返信できません。
**お客様に影響が出るため、Step 2 と続けて行ってください。**

| 場所 | 操作 |
| --- | --- |
| LINE Developers → Messaging API → Webhook | **「Webhookの利用」を OFF**（または URL を削除） |
| LINE Official Account Manager → 応答設定 | 応答メッセージを **ON** に戻す（アプリの代わりに定型文で応答させる） |
| LINE Official Account Manager → リッチメニュー | 公開中のリッチメニューを**非表示または削除**（タップしても開けないため） |
| LINE Developers → LIFF | LIFF アプリを削除（残すなら、エンドポイントが 502 になる点に注意） |

> 運用を完全に終える場合は、LINE 公式アカウント自体を**休止**するか、
> 「サービスを終了しました」という内容のあいさつメッセージに差し替えておくと、
> お客様が問い合わせ先に迷いません。

---

## Step 4. GitHub の Deploy key を削除する

サーバーに置いた鍵を無効にします。

GitHub → リポジトリ `emcyrup/wearPOS` → Settings → **Deploy keys** → 該当の鍵を削除

---

## Step 5. Vercel と Neon を削除する

Vercel は 2026-09-12 に停止済みです。完全に消す場合は次を行います。

| サービス | 操作 |
| --- | --- |
| Vercel | プロジェクト → Settings → 一番下の **Delete Project** |
| Neon | 開発用データベース。必要ならダンプを取ってから、プロジェクトごと削除 |

> Neon には開発中のテストデータが入っています。残す理由がなければ削除してください
> （無料枠でも、放置したアカウントに個人情報が残り続けるのは避けたいところです）。

---

## Step 6. サーバーを返却する

御社（サーバー提供元）へ連絡し、返却・停止の手続きを進めます。あわせて依頼してください。

- PostgreSQL のデータベース `wearpos` とユーザー `ai_labo_dbuser` の削除
- nginx の `wearpos.ai-labo.cloud` の設定と証明書の削除
- 自動ダンプ・AWS Backup に残っているバックアップの扱い（保管するか削除するか）

**サーバー上の `.env` には認証情報が入っています。** 返却前に、こちらで消しておくと確実です。

```bash
shred -u ~/wearPOS/.env 2>/dev/null || rm -f ~/wearPOS/.env
rm -rf ~/wearPOS
rm -f ~/wearpos-backup-*          # 手元に持ち出したことを確認してから
```

---

## Step 7. 認証情報を無効にする

サーバーを消しても、キーそのものは生きています。流出しても悪用されないよう、
**発行元で無効化**してください。

| キー | 無効にする場所 |
| --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic コンソール → API キーを失効 |
| `OPENAI_API_KEY` | OpenAI ダッシュボード → API キーを失効 |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developers → チャネルアクセストークンを再発行または失効 |
| SSH 秘密鍵（`.pem`） | 使わなくなったら手元からも削除 |
| `AUTH_SECRET` / `CRON_SECRET` / `POS_API_KEY` | サーバーと一緒に消えるため対応不要 |

Bitwarden に保管している項目も、不要になったものは整理してください。

---

## 再開したくなったとき

バックアップとこのリポジトリが残っていれば、作り直せます。

1. 新しいサーバーで `bash <(curl -fsSL https://raw.githubusercontent.com/emcyrup/wearPOS/main/scripts/bootstrap-onprem.sh)`
2. `.env` を埋めて起動（[DEPLOY_ONPREM.md](DEPLOY_ONPREM.md)）
3. データを戻す

```bash
pg_restore --no-owner --no-privileges -d "$DATABASE_URL" wearpos-backup-<日時>.dump
npx prisma migrate deploy   # ダンプ以降に追加されたマイグレーションがあれば適用
```

---

## チェックリスト

- [ ] Step 1. バックアップを取り、**手元の PC に持ち出した**
- [ ] バックアップが開けることを確認した（`pg_restore --list`）
- [ ] Step 2. アプリを停止し、crontab を掃除した
- [ ] Step 3. LINE の Webhook・リッチメニューを解除した
- [ ] Step 4. GitHub の Deploy key を削除した
- [ ] Step 5. Vercel / Neon を削除した
- [ ] Step 6. サーバー返却を依頼し、`.env` を消した
- [ ] Step 7. API キーを失効させた
- [ ] バックアップの保管場所を記録した
