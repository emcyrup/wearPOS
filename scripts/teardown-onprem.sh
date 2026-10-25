#!/usr/bin/env bash
#
# 本番サーバー (自己ホスト) の撤去。案件終了・サーバー返却のときに使う。
#
#   cd ~/wearPOS && bash scripts/teardown-onprem.sh
#
# 2 段階で進む。
#   1 回目: データベースのバックアップを取って止まる
#           → 取れたファイルを手元の PC に必ず持ち出す
#   2 回目: bash scripts/teardown-onprem.sh --backup-saved
#           → アプリの停止・PM2 の削除・crontab の掃除を行う
#
# このスクリプトは**データベースを消しません**。消すのはサーバー返却の直前に、
# 手元のバックアップが開けることを確かめてから行ってください。
# sudo は使わない。

set -euo pipefail

# 途中で自分自身が書き換わっても壊れないよう、全体を関数にして先に読み切らせる
main() {
  cd "$(dirname "$0")/.."
  APP_DIR="$(pwd)"
  STAMP="$(date +%Y%m%d-%H%M)"
  DUMP="$HOME/wearpos-backup-${STAMP}.dump"
  SCHEMA_SQL="$HOME/wearpos-backup-${STAMP}.schema.sql"

  log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
  ok()   { printf '   \033[32m✓\033[0m %s\n' "$*"; }
  stop() { printf '\n\033[1;33m■ ここで一度止まります\033[0m\n%s\n' "$*"; exit 2; }
  fail() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

  pm2() { npx --no-install pm2 "$@"; }

  [ -f .env ] || fail ".env がありません。撤去対象のディレクトリで実行してください"

  # -------------------------------------------------------------------------
  if [ "${1:-}" != "--backup-saved" ]; then
    log "1/2 データベースのバックアップ"
    command -v pg_dump >/dev/null || fail "pg_dump がありません"

    DBURL="$(grep -E '^DATABASE_URL=' .env | head -n1 | cut -d= -f2- | tr -d "\"'")"
    [ -n "$DBURL" ] || fail ".env に DATABASE_URL がありません"

    psql "$DBURL" -tAc 'select 1' >/dev/null 2>&1 \
      || fail "データベースに接続できません。.env の DATABASE_URL を確認してください"

    # 復元しやすい圧縮形式と、中身を目で見られる定義の両方を残す
    pg_dump --no-owner --no-privileges --format=custom "$DBURL" > "$DUMP"
    pg_dump --no-owner --no-privileges --schema-only "$DBURL" > "$SCHEMA_SQL"
    chmod 600 "$DUMP" "$SCHEMA_SQL"

    [ -s "$DUMP" ] || fail "バックアップが空です。中断しました"

    ok "$(ls -lh "$DUMP" | awk '{print $9, "(" $5 ")"}')"
    ok "$(ls -lh "$SCHEMA_SQL" | awk '{print $9, "(" $5 ")"}')"

    # 取れた中身の件数を出して、空でないことを目で確かめられるようにする
    log "バックアップ対象の件数"
    psql "$DBURL" -tA -F' | ' -c "
      select '伝票', count(*) from \"Sale\"
      union all select '明細', count(*) from \"SaleLine\"
      union all select '顧客', count(*) from \"Customer\"
      union all select '商品', count(*) from \"Product\"
      union all select 'SKU',  count(*) from \"ProductVariant\"
      union all select '在庫', count(*) from \"Inventory\"
      union all select 'ユーザー', count(*) from \"AppUser\";" | sed 's/^/   /'

    stop "この 2 つのファイルを**手元の PC に持ち出してから**次へ進んでください。

  手元の PC で実行:
    scp -i <鍵ファイル> $(whoami)@<サーバーIP>:${DUMP} .
    scp -i <鍵ファイル> $(whoami)@<サーバーIP>:${SCHEMA_SQL} .

  持ち出せたら、サーバーで次を実行してアプリを停止します:
    cd ${APP_DIR} && bash scripts/teardown-onprem.sh --backup-saved"
  fi

  # -------------------------------------------------------------------------
  log "2/2 アプリの停止"

  if pm2 describe wearpos >/dev/null 2>&1; then
    pm2 stop wearpos >/dev/null || true
    pm2 delete wearpos >/dev/null || true
    ok "PM2 のプロセスを削除しました"
  else
    ok "PM2 のプロセスはありません"
  fi

  # 保存済みのプロセス一覧も空にする (@reboot で復活させない)
  pm2 save --force >/dev/null 2>&1 || true
  pm2 kill >/dev/null 2>&1 || true
  ok "PM2 を終了しました"

  log "crontab から wearPOS の行を削除"
  current="$(crontab -l 2>/dev/null || true)"
  others="$(printf '%s\n' "$current" | grep -v -F "pm2 resurrect" | grep -v -F "reminders-cron.sh" | sed '/^$/d' || true)"
  if [ -n "$others" ]; then
    printf '%s\n' "$others" | crontab -
  else
    crontab -r 2>/dev/null || true
  fi
  ok "削除しました (残り $(crontab -l 2>/dev/null | sed '/^$/d' | wc -l) 行)"

  log "応答が止まったことの確認"
  if curl -fsS --max-time 5 "http://127.0.0.1:8026/api/health" >/dev/null 2>&1; then
    fail "まだ :8026 が応答しています。別のプロセスが残っていないか確認してください"
  fi
  ok "アプリは停止しています"

  cat <<EOF

✅ サーバー上のアプリは停止しました。

残っているもの (意図的に消していません):
  - データベース (このスクリプトでは消しません。返却直前に御社へ依頼してください)
  - ${APP_DIR} のソースと .env (.env には認証情報が入っています)
  - ホームディレクトリのバックアップファイル

このあとの作業は DECOMMISSION.md のチェックリストを参照してください。
  - LINE Developers の Webhook 解除・リッチメニュー削除
  - GitHub の Deploy key 削除
  - Vercel / Neon の削除
  - サーバー返却の連絡

EOF
}

main "$@"
