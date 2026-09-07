#!/usr/bin/env bash
#
# LINE 自動リマインドの定期実行 (本番サーバー用)。
#
# Vercel では vercel.json の crons が /api/reminders/run を毎日呼んでいたが、
# 自己ホストではそれが無いので、ユーザーの crontab から同じ API を叩く。
# sudo は不要 (crontab -e は自分のユーザーで登録できる)。
#
#   crontab -e で以下を1行追加 (毎日 10:00 JST = 01:00 UTC)
#   0 1 * * * /home/prod4/wearPOS/scripts/reminders-cron.sh >> /home/prod4/wearPOS/logs/reminders.log 2>&1
#
# サーバーのタイムゾーンが JST なら「0 10 * * *」にする (date で確認)。

set -euo pipefail

cd "$(dirname "$0")/.."

# .env から CRON_SECRET だけ読む (値は表示しない)
CRON_SECRET="$(grep -E '^CRON_SECRET=' .env | head -n1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
if [ -z "${CRON_SECRET}" ]; then
  echo "$(date -Is) ❌ CRON_SECRET が .env にありません" >&2
  exit 1
fi

echo "$(date -Is) リマインド実行"
curl -fsS --max-time 290 \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  "http://127.0.0.1:8026/api/reminders/run"
echo
