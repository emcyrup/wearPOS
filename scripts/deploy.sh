#!/usr/bin/env bash
#
# 本番サーバー (自己ホスト) の更新スクリプト。
#
#   cd ~/wearPOS && bash scripts/deploy.sh
#
# やること:
#   1. GitHub の main を取り込む
#   2. 依存パッケージを lockfile どおりに入れ直す
#   3. DB のマイグレーションを適用する (未適用のものだけ。データは消えない)
#   4. アプリをビルドする
#   5. PM2 で無停止に入れ替える
#
# 途中で失敗したら、その時点で止まる (古いビルドのまま稼働し続ける)。
# sudo は使わない。すべてホームディレクトリ内で完結する。

set -euo pipefail

cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"
BRANCH="${DEPLOY_BRANCH:-main}"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

if [ ! -f .env ]; then
  echo "❌ .env がありません。.env.production.example を元に作成してください" >&2
  exit 1
fi

# ビルドに必要な最低限の変数だけ確認する (値は表示しない)
for key in DATABASE_URL AUTH_SECRET; do
  if ! grep -qE "^${key}=" .env; then
    echo "❌ .env に ${key} がありません" >&2
    exit 1
  fi
done

log "1/5 ソースを取得 (${BRANCH})"
git fetch origin "${BRANCH}"
git checkout -q "${BRANCH}"
git reset -q --hard "origin/${BRANCH}"
git log --oneline -1

log "2/5 依存パッケージ"
# postinstall で prisma generate が走る
npm ci --no-audit --no-fund

log "3/5 データベースのマイグレーション"
# 未適用のマイグレーションだけを順に適用する。既存データは消えない
npx prisma migrate deploy

log "4/5 ビルド"
# t3.small (2 GiB) でヒープ不足にならないよう上限を明示する
mkdir -p logs
NODE_OPTIONS="--max-old-space-size=1536" npx next build

log "5/5 アプリを入れ替え"
if npx pm2 describe wearpos >/dev/null 2>&1; then
  npx pm2 reload ecosystem.config.cjs --update-env
else
  npx pm2 start ecosystem.config.cjs
fi
npx pm2 save >/dev/null

# 起動確認 (自分自身に対して)
sleep 3
if curl -fsS --max-time 10 "http://127.0.0.1:8026/api/health" >/dev/null; then
  echo
  echo "✅ 更新完了: $(git log --oneline -1)"
else
  echo
  echo "⚠️  アプリの応答がありません。ログを確認してください: npx pm2 logs wearpos --lines 100" >&2
  exit 1
fi
