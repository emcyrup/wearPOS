#!/usr/bin/env bash
#
# 本番サーバー (自己ホスト) の初回セットアップを 1 コマンドで行う。
#
#   サーバーに SSH で入ってから:
#     bash <(curl -fsSL https://raw.githubusercontent.com/emcyrup/wearPOS/main/scripts/bootstrap-onprem.sh)
#   または clone 済みなら:
#     bash ~/wearPOS/scripts/bootstrap-onprem.sh
#
# 何度実行しても安全 (済んでいる手順は飛ばす)。sudo は使わない。
# 止まるのは 2 回だけ:
#   (1) GitHub の Deploy key 登録が必要なとき → 公開鍵を表示して止まる
#   (2) .env の値を埋める必要があるとき     → 雛形を置いて止まる
# それぞれ対応してから、同じコマンドをもう一度実行すれば続きから進む。

set -euo pipefail

REPO_SSH="git@github.com:emcyrup/wearPOS.git"
APP_DIR="${WEARPOS_DIR:-$HOME/wearPOS}"
PORT=8026

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '   \033[32m✓\033[0m %s\n' "$*"; }
stop() { printf '\n\033[1;33m■ ここで一度止まります\033[0m\n%s\n\n対応したら、もう一度同じコマンドを実行してください。\n' "$*"; exit 2; }
fail() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
log "0/8 前提の確認"
command -v node >/dev/null || fail "node がありません (御社案内では v22 が入っているはず)"
command -v git  >/dev/null || fail "git がありません"
command -v psql >/dev/null || fail "psql がありません"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || fail "Node.js 22 以上が必要です (いま: $(node -v))"
ok "node $(node -v) / $(psql --version | awk '{print $1,$2,$3}') / タイムゾーン $(date +%Z)"

# ---------------------------------------------------------------------------
log "1/8 GitHub 用の SSH 鍵 (ホームディレクトリ内)"
mkdir -p ~/.ssh && chmod 700 ~/.ssh
if [ ! -f ~/.ssh/id_ed25519 ]; then
  ssh-keygen -t ed25519 -C "wearpos@$(hostname)" -f ~/.ssh/id_ed25519 -N "" >/dev/null
  ok "鍵を作成しました"
fi
if ! grep -q "github.com" ~/.ssh/known_hosts 2>/dev/null; then
  ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts 2>/dev/null || true
fi
# GitHub は認証成功でも ssh -T が終了コード 1 を返す。pipefail の影響を受けないよう出力を先に受ける
GH_CHECK="$(ssh -T -o BatchMode=yes -o ConnectTimeout=10 git@github.com 2>&1 || true)"
if ! printf '%s' "$GH_CHECK" | grep -q "successfully authenticated"; then
  stop "この公開鍵を GitHub リポジトリ (emcyrup/wearPOS) → Settings → Deploy keys に登録してください (Allow write access は不要):

$(cat ~/.ssh/id_ed25519.pub)"
fi
ok "GitHub に接続できます"

# ---------------------------------------------------------------------------
log "2/8 ソースコード"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone -q "$REPO_SSH" "$APP_DIR"
  ok "clone しました: $APP_DIR"
else
  git -C "$APP_DIR" fetch -q origin main
  git -C "$APP_DIR" checkout -q main
  git -C "$APP_DIR" reset -q --hard origin/main
  ok "最新の main に更新しました"
fi
cd "$APP_DIR"
git log --oneline -1 | sed 's/^/   /'

# ---------------------------------------------------------------------------
log "3/8 依存パッケージ (postinstall で prisma generate)"
npm ci --no-audit --no-fund --loglevel=error
# pm2 は devDependencies に入っているので npm ci で入る (古い環境向けの保険)
if ! npx --no-install pm2 -v >/dev/null 2>&1; then
  npm install --no-save --no-audit --no-fund --loglevel=error pm2
fi
ok "npm ci 完了 / pm2 $(npx --no-install pm2 -v)"

# ---------------------------------------------------------------------------
log "4/8 .env"
if [ ! -f .env ]; then
  cp .env.production.example .env
  # 乱数が要る 3 つはここで埋めておく (手で作らなくてよい)
  for key in AUTH_SECRET CRON_SECRET POS_API_KEY; do
    val="$(openssl rand -base64 32 | tr -d '\n')"
    sed -i "s|^${key}=\"\"|${key}=\"${val}\"|" .env
  done
  chmod 600 .env
  stop ".env を作成し、AUTH_SECRET / CRON_SECRET / POS_API_KEY は自動生成しました。
次を埋めてください:  nano $APP_DIR/.env

  DATABASE_URL  … 御社発行のパスワードを URL エンコードして入れる
                  (! → %21, * → %2A, \$ → %24, # → %23。行はシングルクォートで囲む)
  LINE_*        … 開発環境 (Vercel) と同じ値
  ANTHROPIC_API_KEY / OPENAI_API_KEY … 使う場合"
fi
chmod 600 .env
# 必須項目が埋まっているか (値は表示しない)
missing=()
for key in DATABASE_URL AUTH_SECRET APP_URL CRON_SECRET; do
  v="$(grep -E "^${key}=" .env | head -n1 | cut -d= -f2- | tr -d "\"'" )"
  case "$v" in ""|*"<"*">"*) missing+=("$key");; esac
done
[ "${#missing[@]}" -eq 0 ] || stop "次の値が未入力です: ${missing[*]}   → nano $APP_DIR/.env"
ok "必須項目はそろっています"

# DB に実際につながるか (エンコード間違いをここで見つける)
DBURL="$(grep -E '^DATABASE_URL=' .env | head -n1 | cut -d= -f2- | tr -d "\"'")"
if ! psql "$DBURL" -tAc 'select 1' >/dev/null 2>&1; then
  fail "DATABASE_URL で接続できません。パスワードの URL エンコード (%21 %2A %24 %23) と
   シングルクォートを確認してください:  psql \"\$DATABASE_URL\" -c 'select 1'"
fi
ok "データベースに接続できます ($(psql "$DBURL" -tAc 'select version()' | awk '{print $1,$2}'))"

# ---------------------------------------------------------------------------
log "5/8 マイグレーション (未適用のものだけ。データは消えない)"
npx prisma migrate deploy 2>&1 | tail -n 2 | sed 's/^/   /'
ok "スキーマは最新です"

# ---------------------------------------------------------------------------
log "6/8 ビルド (t3.small 向けにヒープ上限 1536MB)"
mkdir -p logs
NODE_OPTIONS="--max-old-space-size=1536" npx next build > logs/build.log 2>&1 \
  || { tail -n 30 logs/build.log; fail "ビルドに失敗しました (logs/build.log)"; }
ok "ビルド完了"

# ---------------------------------------------------------------------------
log "7/8 PM2 で起動 (:$PORT)"
if npx --no-install pm2 describe wearpos >/dev/null 2>&1; then
  npx --no-install pm2 reload ecosystem.config.cjs --update-env >/dev/null
  ok "無停止で入れ替えました"
else
  npx --no-install pm2 start ecosystem.config.cjs >/dev/null
  ok "起動しました"
fi
npx --no-install pm2 save >/dev/null

# ---------------------------------------------------------------------------
log "8/8 crontab (自動起動 + LINE リマインド)。重複登録はしない"
CRON_BOOT="@reboot cd $APP_DIR && /usr/bin/env npx --no-install pm2 resurrect >> $APP_DIR/logs/pm2-boot.log 2>&1"
if [ "$(date +%Z)" = "JST" ]; then HOUR=10; else HOUR=1; fi   # 10:00 JST
CRON_REM="0 $HOUR * * * $APP_DIR/scripts/reminders-cron.sh >> $APP_DIR/logs/reminders.log 2>&1"
current="$(crontab -l 2>/dev/null || true)"
# 既存の登録から wearPOS の 2 行だけ外して足し直す (grep が「全部除外」で exit 1 になっても止めない)
others="$(printf '%s\n' "$current" | grep -v -F "pm2 resurrect" | grep -v -F "reminders-cron.sh" | sed '/^$/d' || true)"
{
  [ -n "$others" ] && printf '%s\n' "$others"
  printf '%s\n%s\n' "$CRON_BOOT" "$CRON_REM"
} | crontab -
ok "登録しました (リマインドは毎日 $(printf '%02d' "$HOUR"):00 $(date +%Z))"

# ---------------------------------------------------------------------------
log "動作確認"
sleep 3
if curl -fsS --max-time 15 "http://127.0.0.1:$PORT/api/health" | grep -q '"dbError":null'; then
  ok "アプリが :$PORT で応答し、DB にもつながっています"
else
  npx --no-install pm2 logs wearpos --lines 40 --nostream || true
  fail "アプリの応答がありません"
fi

cat <<EOF

✅ セットアップ完了: $(git log --oneline -1)

次にブラウザで開いてください:
  https://wearpos.ai-labo.cloud/
  → 初回は「初期セットアップ」画面で管理者アカウントを作成
  → 設定 → レジ端末のアクセス でレジ端末コードを決める
  → LINE Developers の Webhook URL / LIFF エンドポイントを新ドメインへ (DEPLOY_ONPREM.md Step 7)

以後の更新:  cd $APP_DIR && bash scripts/deploy.sh
EOF
